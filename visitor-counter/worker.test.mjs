import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker, { handleRequest, WINDOW_MS } from './worker.mjs';

const origin = 'https://shiyuandong-robot.github.io';
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

function fixture() {
    const db = new DatabaseSync(':memory:');
    db.exec(schema);
    const prepare = sql => ({
        sql,
        args: [],
        bind(...args) { this.args = args; return this; },
        first() { return Promise.resolve(db.prepare(sql).get(...this.args)); }
    });
    const env = {
        VISITOR_HASH_SECRET: 'test-only-secret-with-at-least-32-characters',
        COUNTER_DB: {
            prepare,
            async batch(statements) {
                db.exec('BEGIN');
                try {
                    const results = statements.map(s => ({ results: db.prepare(s.sql).all(...s.args) }));
                    db.exec('COMMIT');
                    return results;
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            }
        }
    };
    return { db, env };
}

function request(ip = '203.0.113.1', path = '/visit', method = 'POST', extra = {}) {
    return new Request(`https://counter.example${path}`, {
        method, headers: { Origin: origin, 'CF-Connecting-IP': ip, ...extra }
    });
}

test('same IP across refreshes and browsers counts once for a rolling 24 hours', async () => {
    const { db, env } = fixture();
    const start = Date.parse('2026-10-08T02:00:00Z');
    assert.equal((await (await handleRequest(request(), env, start)).json()).total, 1);
    for (const offset of [1, 10000, WINDOW_MS - 1]) {
        const result = await (await handleRequest(request(undefined, '/visit', 'POST', { 'User-Agent': `Browser ${offset}` }), env, start + offset)).json();
        assert.equal(result.total, 1);
    }
    const next = await (await handleRequest(request(), env, start + WINDOW_MS)).json();
    assert.deepEqual(next, { today: 1, total: 2, date: '2026-10-09', timeZone: 'Asia/Shanghai' });
    assert.equal(db.prepare('SELECT count(*) AS n FROM visitor_tokens').get().n, 1);
    db.close();
});

test('crossing Shanghai midnight does not bypass the rolling window', async () => {
    const { db, env } = fixture();
    const start = Date.parse('2026-10-08T15:59:59Z');
    await handleRequest(request(), env, start);
    const repeat = await (await handleRequest(request(), env, start + 2000)).json();
    assert.deepEqual(repeat, { today: 0, total: 1, date: '2026-10-09', timeZone: 'Asia/Shanghai' });
    const different = await (await handleRequest(request('203.0.113.2'), env, start + 2000)).json();
    assert.equal(different.today, 1);
    assert.equal(different.total, 2);
    db.close();
});

test('concurrent duplicate requests increment once; stats reads never increment', async () => {
    const { db, env } = fixture();
    const now = Date.parse('2026-10-09T02:00:00Z');
    const responses = await Promise.all(Array.from({ length: 30 }, () => handleRequest(request(), env, now)));
    assert.ok(responses.every(response => response.status === 200));
    const stats = await (await handleRequest(request(undefined, '/stats', 'GET'), env, now)).json();
    assert.equal(stats.total, 1);
    assert.equal(stats.today, 1);
    const stored = db.prepare('SELECT token FROM visitor_tokens').get().token;
    assert.match(stored, /^[a-f0-9]{64}$/);
    assert.ok(!stored.includes('203.0.113.1'));
    db.close();
});

test('untrusted origins and missing IPs do not create visits; responses are not cached', async () => {
    const { db, env } = fixture();
    assert.equal((await handleRequest(request(undefined, '/visit', 'POST', { Origin: 'https://unrelated.example' }), env)).status, 403);
    assert.equal((await handleRequest(new Request('https://counter.example/visit', { method: 'POST', headers: { Origin: origin } }), env)).status, 400);
    assert.equal((await handleRequest(request(undefined, '/visit', 'GET'), env)).status, 405);
    assert.equal((await handleRequest(request(), { ...env, VISITOR_HASH_SECRET: '' })).status, 503);
    const response = await worker.fetch(request(), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(db.prepare('SELECT count FROM visitor_total').get().count, 1);
    db.close();
});

test('transaction failures roll back both deduplication and aggregate counts', async () => {
    const { db, env } = fixture();
    const batch = env.COUNTER_DB.batch;
    env.COUNTER_DB.batch = statements => batch([...statements, env.COUNTER_DB.prepare('SELECT missing_column FROM visitor_total')]);
    assert.equal((await handleRequest(request(), env)).status, 503);
    assert.equal(db.prepare('SELECT count FROM visitor_total').get().count, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM visitor_tokens').get().n, 0);
    db.close();
});
