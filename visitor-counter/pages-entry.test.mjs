import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import bridge from './pages-entry/_worker.js';
import { handleRequest } from './worker.mjs';

const ORIGIN = 'https://shiyuandong-robot.github.io';
const NOW = Date.parse('2026-10-09T10:00:00Z');
const visitorSchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const commentsSchema = readFileSync(new URL('./comments-schema.sql', import.meta.url), 'utf8');

function request(path = '/stats', method = 'GET', headers = {}, body) {
    return new Request(`https://homepage-api.example${path}`, {
        method,
        headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.1', ...headers },
        ...(body === undefined ? {} : { body })
    });
}

function fixture(t) {
    const db = new DatabaseSync(':memory:');
    db.exec(visitorSchema);
    db.exec(commentsSchema);
    t.after(() => db.close());
    const prepare = sql => ({
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        first() { return Promise.resolve(db.prepare(sql).get(...this.args)); }
    });
    const backendEnv = {
        VISITOR_HASH_SECRET: 'test-only-secret-with-at-least-32-characters',
        COUNTER_DB: {
            prepare,
            async batch(statements) {
                db.exec('BEGIN');
                try {
                    const results = statements.map(s => ({
                        results: db.prepare(s.sql).all(...s.args),
                        meta: { changes: db.prepare('SELECT changes() AS n').get().n }
                    }));
                    db.exec('COMMIT');
                    return results;
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            }
        }
    };
    const env = { HOMEPAGE_API: { fetch: req => handleRequest(req, backendEnv, NOW) } };
    return { db, backendEnv, env };
}

test('health reveals only reachability and does not call the binding', async () => {
    const env = { HOMEPAGE_API: { fetch() { assert.fail('Health must not read backend data'); } } };
    const response = await bridge.fetch(request('/'), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const head = await bridge.fetch(request('/', 'HEAD'), {});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await bridge.fetch(request('/', 'POST'), env)).status, 405);
});

test('only the three API paths are forwarded', async () => {
    let calls = 0;
    const env = { HOMEPAGE_API: { fetch() { calls++; return new Response('ok'); } } };
    for (const path of ['/comments', '/visit', '/stats']) assert.equal((await bridge.fetch(request(path), env)).status, 200);
    for (const path of ['/admin', '/comments/', '/_worker.js', '/index.html', '//external.example/stats']) {
        assert.equal((await bridge.fetch(request(path), env)).status, 404);
    }
    assert.equal(calls, 3);
});

test('forwards the exact Request and response, including body, Origin, preflight and retry headers', async () => {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
        const input = request('/comments?key=value', method, {
            Origin: 'https://untrusted.example', 'CF-Connecting-IPv6': '2001:db8::1',
            'X-Forwarded-For': '198.51.100.99', 'Content-Type': 'application/json',
            'Access-Control-Request-Method': 'POST'
        }, method === 'POST' ? '{"message":"test"}' : undefined);
        const output = new Response('backend reply', { status: 429, headers: { 'Retry-After': '60' } });
        const env = { HOMEPAGE_API: { async fetch(received) {
            assert.strictEqual(received, input);
            assert.equal(received.headers.get('Origin'), 'https://untrusted.example');
            assert.equal(received.headers.get('CF-Connecting-IP'), '203.0.113.1');
            assert.equal(received.headers.get('CF-Connecting-IPv6'), '2001:db8::1');
            if (method === 'POST') assert.equal(await received.text(), '{"message":"test"}');
            return output;
        } } };
        assert.strictEqual(await bridge.fetch(input, env), output);
    }
});

test('unavailable bindings return a private 503 with only allowed-origin CORS', async () => {
    for (const env of [{}, { HOMEPAGE_API: {} }, { HOMEPAGE_API: { fetch() { throw new Error('private details'); } } }]) {
        const response = await bridge.fetch(request('/comments'), env);
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
        assert.deepEqual(await response.json(), { error: 'Service temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' });
        const denied = await bridge.fetch(request('/comments', 'OPTIONS', { Origin: 'https://untrusted.example' }), env);
        assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
        const preview = await bridge.fetch(request('/comments', 'GET', { Origin: 'http://127.0.0.1:8765' }), env);
        assert.equal(preview.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:8765');
        const previewPost = await bridge.fetch(request('/comments', 'POST', { Origin: 'http://127.0.0.1:8765' }), env);
        assert.equal(previewPost.headers.get('Access-Control-Allow-Origin'), null);
    }
});

test('bridge and direct endpoint share visit counts and the same rolling IP identity', async t => {
    const { env, backendEnv, db } = fixture(t);
    const direct = await handleRequest(request('/visit', 'POST'), backendEnv, NOW);
    assert.equal((await direct.json()).total, 1);
    const bridged = await bridge.fetch(request('/visit', 'POST', { 'X-Forwarded-For': '198.51.100.42' }), env);
    assert.equal((await bridged.json()).total, 1);
    const before = await (await handleRequest(request('/stats'), backendEnv, NOW)).json();
    const after = await (await bridge.fetch(request('/stats'), env)).json();
    assert.deepEqual(after, before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visitor_tokens').get().n, 1);
});

test('bridge shares comments, idempotency and rate limits with the existing database', async t => {
    const { env, backendEnv, db } = fixture(t);
    const body = JSON.stringify({ nickname: 'Test', anonymous: false, avatar: 'cat', message: 'Local test', requestId: crypto.randomUUID(), website: '' });
    const headers = { 'Content-Type': 'application/json' };
    const direct = await handleRequest(request('/comments', 'POST', headers, body), backendEnv, NOW);
    assert.equal(direct.status, 201);
    const repeated = await bridge.fetch(request('/comments', 'POST', headers, body), env);
    assert.equal(repeated.status, 200);
    const directRead = await (await handleRequest(request('/comments'), backendEnv, NOW)).json();
    const bridgeRead = await (await bridge.fetch(request('/comments'), env)).json();
    assert.deepEqual(bridgeRead, directRead);
    assert.equal(bridgeRead.total, 1);
    const next = JSON.stringify({ ...JSON.parse(body), requestId: crypto.randomUUID() });
    const limited = await bridge.fetch(request('/comments', 'POST', headers, next), env);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('Retry-After'), '60');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1);
});

test('the backend still denies foreign origins and never trusts forwarded address substitutes', async t => {
    const { env, db } = fixture(t);
    assert.equal((await bridge.fetch(request('/comments', 'GET', { Origin: 'https://untrusted.example' }), env)).status, 403);
    const input = new Request('https://homepage-api.example/visit', {
        method: 'POST', headers: { Origin: ORIGIN, 'X-Forwarded-For': '203.0.113.2', 'X-Real-IP': '203.0.113.2' }
    });
    assert.equal((await bridge.fetch(input, env)).status, 400);
    assert.equal(db.prepare('SELECT count FROM visitor_total').get().count, 0);
    const preflight = await bridge.fetch(request('/comments', 'OPTIONS', { 'Access-Control-Request-Method': 'POST' }), env);
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});
