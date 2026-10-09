import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import vm from 'node:vm';
import { handleRequest } from './worker.mjs';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const ORIGIN = 'https://shiyuandong-robot.github.io';
const START = Date.parse('2026-10-09T10:00:00Z');
const tick = () => new Promise(resolve => setImmediate(resolve));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const stats = { today: 4, total: 12, date: '2026-10-09', timeZone: 'Asia/Shanghai' };

class Node extends EventTarget {
    constructor(tag = 'div') { super(); this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.textContent = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    focus() {}
}

function fixture(fetch, options = {}) {
    const timers = new Map();
    let timerId = 0;
    let now = START;
    const window = new EventTarget();
    window.location = { origin: ORIGIN, hostname: 'shiyuandong-robot.github.io' };
    const document = new EventTarget();
    document.visibilityState = 'visible';
    document.createElement = tag => new Node(tag);
    const today = new Node('span');
    const total = new Node('span');
    const panel = new Node();
    panel.querySelector = selector => selector.includes('today') ? today : total;
    const mount = new Node();
    document.querySelector = selector => ({
        'meta[name="visitor-counter-endpoint"]': { content: 'https://primary.example/' },
        'meta[name="homepage-api-fallback"]': { content: 'https://fallback.example/' },
        '.visitor-counter': panel, '#guestbook': mount
    }[selector] || null);
    class ClockDate extends Date { static now() { return now; } }
    const context = vm.createContext({
        window, document, navigator: { onLine: true }, fetch, URL, AbortController,
        crypto: options.crypto || webcrypto, Uint8Array, Intl, Date: ClockDate,
        setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(source('api.js'), context);
    const runDelay = delay => {
        const entry = [...timers].find(([, timer]) => timer.delay === delay);
        assert.ok(entry, `Expected a ${delay} ms timer`);
        timers.delete(entry[0]);
        entry[1].callback();
    };
    return { context, api: window.HomepageApi, window, document, timers, runDelay,
        panel, today, total, mount, advance: ms => { now += ms; },
        load: name => vm.runInContext(source(name), context) };
}

function database(t) {
    const db = new DatabaseSync(':memory:');
    for (const file of ['schema.sql', 'comments-schema.sql']) db.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
    t.after(() => db.close());
    const env = {
        VISITOR_HASH_SECRET: 'test-secret-used-only-by-the-local-suite',
        COUNTER_DB: {
            prepare(sql) {
                return { sql, args: [], bind(...args) { this.args = args; return this; },
                    async first() { return db.prepare(sql).get(...this.args); } };
            },
            async batch(statements) {
                db.exec('BEGIN');
                try {
                    const results = statements.map(statement => ({
                        results: db.prepare(statement.sql).all(...statement.args),
                        meta: { changes: db.prepare('SELECT changes() AS n').get().n }
                    }));
                    db.exec('COMMIT');
                    return results;
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            }
        }
    };
    return { db, env };
}

test('network and server failures use the alternate endpoint; successful alternate is remembered', async () => {
    const calls = [];
    const f = fixture(async url => {
        calls.push(url);
        if (url.startsWith('https://primary.')) throw new TypeError('Network unavailable');
        return json({ comments: [], total: 0 });
    });
    assert.equal((await f.api.request('comments')).data.total, 0);
    await f.api.request('comments');
    assert.deepEqual(calls, ['https://primary.example/comments', 'https://fallback.example/comments', 'https://fallback.example/comments']);
    let count = 0;
    const unavailable = fixture(async () => ++count === 1 ? json({ error: 'Unavailable' }, 503) : json(stats));
    assert.equal((await unavailable.api.request('stats')).data.total, 12);
    assert.equal(count, 2);
});

test('validation and rate limits never fail over or lose Retry-After', async () => {
    for (const status of [400, 403, 409, 429]) {
        let calls = 0;
        const f = fixture(async () => {
            calls++;
            return new Response(JSON.stringify({ code: 'APPLICATION_ERROR' }), { status, headers: { 'Retry-After': '60' } });
        });
        const result = await f.api.request('comments', { method: 'POST', body: { requestId: 'unchanged' } });
        assert.equal(result.response.status, status);
        assert.equal(result.response.headers.get('Retry-After'), '60');
        assert.equal(calls, 1);
    }
});

test('each endpoint has a 20 second deadline; external cancellation stops failover', async () => {
    let calls = 0;
    const blocked = (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => {
        const error = new Error('Aborted'); error.name = 'AbortError'; reject(error);
    }, { once: true }));
    const f = fixture((url, options) => ++calls === 1 ? blocked(url, options) : Promise.resolve(json(stats)));
    const pending = f.api.request('stats');
    f.runDelay(20000);
    assert.equal((await pending).data.total, 12);
    assert.equal(calls, 2);
    calls = 0;
    const cancelled = fixture((...args) => { calls++; return blocked(...args); });
    const controller = new AbortController();
    const request = cancelled.api.request('comments', { signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    assert.equal(calls, 1);
    assert.equal(cancelled.timers.size, 0);
});

test('a committed POST with a lost response is counted/published only once after failover', async t => {
    const { db, env } = database(t);
    for (const path of ['comments', 'visit']) {
        const calls = [];
        const f = fixture(async (url, options) => {
            calls.push(options.body);
            const request = new Request(url, { method: options.method, body: options.body,
                headers: { ...options.headers, Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.8' } });
            const response = await handleRequest(request, env, START);
            if (calls.length === 1) throw new TypeError('Connection lost after commit');
            return response;
        });
        const body = path === 'comments' ? { nickname: 'Test', anonymous: false, avatar: 'cat', message: 'Local test', website: '', requestId: webcrypto.randomUUID() } : undefined;
        const result = await f.api.request(path, { method: 'POST', body });
        assert.equal(result.response.status, 200);
        assert.equal(calls.length, 2);
        assert.equal(calls[0], calls[1]);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1);
    assert.equal(db.prepare('SELECT count FROM visitor_total WHERE id = 1').get().count, 1);
});

test('automatic retries are bounded and network/page recovery resumes failed loads', () => {
    const f = fixture(() => {});
    let attempts = 0;
    const recovery = f.api.createRecovery(() => { attempts++; recovery.pending(); recovery.failed(); });
    recovery.failed();
    for (const delay of [2000, 8000, 30000]) f.runDelay(delay);
    assert.equal(attempts, 3);
    assert.equal(f.timers.size, 0);
    f.context.navigator.onLine = false;
    f.window.dispatchEvent(new Event('pageshow'));
    assert.equal(attempts, 3);
    f.context.navigator.onLine = true;
    f.window.dispatchEvent(new Event('online'));
    assert.equal(attempts, 4);
    f.document.visibilityState = 'hidden';
    f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(attempts, 4);
    f.document.visibilityState = 'visible';
    f.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(attempts, 5);
    recovery.succeeded();
    f.window.dispatchEvent(new Event('pageshow'));
    assert.equal(attempts, 5);
    assert.equal(f.timers.size, 0);
});

test('UUID generation works with getRandomValues when older Safari lacks randomUUID', () => {
    const f = fixture(() => {}, { crypto: { getRandomValues: array => webcrypto.getRandomValues(array) } });
    assert.equal(f.api.canCreateRequestId, true);
    const first = f.api.createRequestId();
    assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.notEqual(first, f.api.createRequestId());
});

test('visitor loading retries a failed registration and preserves valid numbers on refresh failure', async () => {
    let online = false;
    const methods = [];
    const f = fixture(async (url, options) => {
        methods.push(options.method);
        if (!online) throw new TypeError('Offline');
        return json(stats);
    });
    f.load('visitors.js');
    await tick();
    assert.equal(f.today.textContent, '—');
    online = true;
    f.window.dispatchEvent(new Event('online'));
    await tick();
    assert.equal(f.today.textContent, '4');
    assert.equal(f.total.textContent, '12');
    assert.deepEqual(methods, ['POST', 'POST', 'POST']);
    online = false;
    f.advance(61000);
    f.window.dispatchEvent(new Event('pageshow'));
    await tick();
    assert.equal(f.panel.dataset.counterState, 'stale');
    assert.equal(f.total.textContent, '12');
    assert.deepEqual(methods.slice(-2), ['GET', 'GET']);
    online = true;
    f.window.dispatchEvent(new Event('online'));
    await tick();
    assert.equal(f.panel.dataset.counterState, 'ready');
});

test('guestbook recovers from offline startup and retains loaded notes after refresh failure', async () => {
    let online = false;
    const comment = { id: webcrypto.randomUUID(), nickname: 'Test', avatar: 'fox', message: '<b>Plain text</b>', createdAt: new Date(START).toISOString() };
    const f = fixture(async () => {
        if (!online) throw new TypeError('Offline');
        return json({ comments: [comment], total: 1 });
    });
    f.load('guestbook.js');
    await tick();
    const recent = f.mount.children[1];
    const [status, list, retry] = recent.children;
    assert.equal(status.dataset.state, 'error');
    online = true;
    f.window.dispatchEvent(new Event('online'));
    await tick();
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].children[0].children[1].textContent, comment.message);
    online = false;
    retry.dispatchEvent(new Event('click'));
    await tick();
    assert.equal(status.dataset.state, 'error');
    assert.equal(list.children.length, 1);
    assert.match(status.textContent, /last loaded/);
    online = true;
    f.window.dispatchEvent(new Event('pageshow'));
    await tick();
    assert.equal(status.dataset.state, 'ready');
});
