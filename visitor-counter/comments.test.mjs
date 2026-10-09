import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker, { handleRequest, hashIp, WINDOW_MS } from './worker.mjs';

const ORIGIN = 'https://shiyuandong-robot.github.io';
const PREVIEW = 'http://127.0.0.1:8765';
const START = Date.parse('2026-10-09T15:59:30Z');
const commentsSchema = readFileSync(new URL('./comments-schema.sql', import.meta.url), 'utf8');
const visitorSchema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

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
    const env = {
        VISITOR_HASH_SECRET: 'test-only-secret-with-at-least-32-characters',
        COUNTER_DB: {
            prepare,
            async batch(statements) {
                db.exec('BEGIN');
                try {
                    const results = statements.map(statement => {
                        const rows = db.prepare(statement.sql).all(...statement.args);
                        return { results: rows, meta: { changes: db.prepare('SELECT changes() AS n').get().n } };
                    });
                    db.exec('COMMIT');
                    return results;
                } catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                }
            }
        }
    };
    return { db, env };
}

function payload(overrides = {}) {
    return { nickname: 'Visitor', anonymous: false, avatar: 'cat', message: 'Hello!', requestId: crypto.randomUUID(), website: '', ...overrides };
}

function request(body = payload(), options = {}) {
    const method = options.method || 'POST';
    return new Request(`https://counter.example${options.path || '/comments'}`, {
        method,
        headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.1', 'Content-Type': 'application/json', ...options.headers },
        ...(method === 'POST' ? { body: options.rawBody ?? JSON.stringify(body) } : {}),
        ...(options.rawBody instanceof ReadableStream ? { duplex: 'half' } : {})
    });
}

async function send(env, body, now = START, options) {
    const response = await handleRequest(request(body, options), env, now);
    return { response, json: await response.json() };
}

test('comments migration is idempotent and latest-three response contains only public fields', async t => {
    const { db, env } = fixture(t);
    db.exec(commentsSchema);
    const empty = await send(env, null, START, { method: 'GET' });
    assert.deepEqual(empty.json, { comments: [], total: 0 });
    const created = [];
    for (let i = 0; i < 4; i++) {
        const body = payload({ nickname: `Visitor ${i}`, avatar: ['cat', 'bunny', 'bear', 'panda'][i] });
        const result = await send(env, body, START + i, { headers: { 'CF-Connecting-IP': `203.0.113.${i + 1}` } });
        assert.equal(result.response.status, 201);
        assert.deepEqual(result.json.comment, { id: body.requestId, nickname: body.nickname, avatar: body.avatar, message: body.message, createdAt: new Date(START + i).toISOString() });
        created.push(result.json.comment);
    }
    const result = await send(env, null, START + 10, { method: 'GET' });
    assert.deepEqual(result.json, { comments: created.slice(1).reverse(), total: 4 });
    assert.equal(db.prepare('SELECT count FROM visitor_total').get().count, 0);
});

test('anonymous submissions discard supplied nicknames; all avatars and Unicode text round-trip', async t => {
    const { db, env } = fixture(t);
    const result = await send(env, payload({ anonymous: true, nickname: 'Do not store this name', message: '你好 🌍 <script>alert("xss")</script> & "quote"\nSecond line' }));
    assert.equal(result.response.status, 201);
    assert.equal(result.json.comment.nickname, 'Anonymous');
    assert.equal(result.json.comment.message, '你好 🌍 <script>alert("xss")</script> & "quote"\nSecond line');
    assert.equal(result.response.headers.get('Content-Type'), 'application/json; charset=utf-8');
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM comments').all()).includes('Do not store this name'));
    for (const [i, avatar] of ['cat', 'bunny', 'bear', 'panda', 'fox', 'robot'].entries()) {
        const posted = await send(env, payload({ nickname: '😀'.repeat(24), message: '🦊'.repeat(500), avatar }), START + (i + 1) * 60000, { headers: { 'CF-Connecting-IP': `198.51.100.${i + 1}` } });
        assert.equal(posted.response.status, 201);
        assert.equal(Array.from(posted.json.comment.message).length, 500);
    }
});

test('invalid fields and honeypots produce stable errors without storing rows', async t => {
    const { db, env } = fixture(t);
    const cases = [
        [{ nickname: '' }, 'INVALID_NICKNAME'], [{ nickname: ' '.repeat(5) }, 'INVALID_NICKNAME'],
        [{ nickname: '😀'.repeat(25) }, 'INVALID_NICKNAME'], [{ nickname: 123 }, 'INVALID_NICKNAME'],
        [{ nickname: '\u0000Name' }, 'INVALID_NICKNAME'], [{ message: '\u0000Text' }, 'INVALID_MESSAGE'],
        [{ message: '' }, 'INVALID_MESSAGE'], [{ message: 'x'.repeat(501) }, 'INVALID_MESSAGE'],
        [{ message: null }, 'INVALID_MESSAGE'], [{ avatar: '<svg>' }, 'INVALID_AVATAR'],
        [{ avatar: null }, 'INVALID_AVATAR'], [{ anonymous: 'true' }, 'INVALID_ANONYMOUS'],
        [{ requestId: 'not-a-uuid' }, 'INVALID_REQUEST_ID'], [{ website: 'https://spam.example' }, 'INVALID_SUBMISSION'],
        [{ website: ' ' }, 'INVALID_SUBMISSION']
    ];
    for (const [override, code] of cases) {
        const result = await send(env, payload(override));
        assert.equal(result.response.status, 400, JSON.stringify(override));
        assert.equal(result.json.code, code);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 0);
});

test('JSON, UTF-8 and streamed byte limits are enforced including misleading Content-Length', async t => {
    const { env } = fixture(t);
    for (const rawBody of ['{', 'null', '[]', '"string"', new Uint8Array([0xff])]) {
        const result = await send(env, null, START, { rawBody });
        assert.equal(result.response.status, 400);
        assert.equal(result.json.code, 'INVALID_JSON');
    }
    assert.equal((await send(env, payload(), START, { headers: { 'Content-Type': 'text/plain' } })).response.status, 415);
    assert.equal((await send(env, payload(), START, { headers: { 'Content-Length': '4097' } })).response.status, 413);
    const encoded = new TextEncoder().encode(JSON.stringify(payload()));
    const exact = new Uint8Array(4096).fill(32);
    exact.set(encoded);
    assert.equal((await send(env, null, START, { rawBody: exact })).response.status, 201);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3000).fill(32)); controller.enqueue(new Uint8Array(1097).fill(32)); controller.close(); } });
    const excessive = await send(env, null, START, { rawBody: stream, headers: { 'Content-Length': '1' } });
    assert.equal(excessive.response.status, 413);
    assert.equal(excessive.json.code, 'BODY_TOO_LARGE');
});

test('CORS permits production JSON writes and preview reads without broadening visitor routes', async t => {
    const { env } = fixture(t);
    const options = await handleRequest(request(null, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), env, START);
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.equal(options.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
    assert.equal(options.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
    const preview = await send(env, null, START, { method: 'GET', headers: { Origin: PREVIEW } });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.response.headers.get('Access-Control-Allow-Origin'), PREVIEW);
    assert.equal(preview.response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
    for (const options of [
        { headers: { Origin: PREVIEW } },
        { method: 'OPTIONS', headers: { Origin: PREVIEW, 'Access-Control-Request-Method': 'POST' } },
        { method: 'GET', headers: { Origin: 'https://untrusted.example' } },
        { method: 'GET', headers: { Origin: 'null' } },
        { path: '/stats', method: 'GET', headers: { Origin: PREVIEW } },
        { path: '/visit', headers: { Origin: PREVIEW } }
    ]) {
        const response = await handleRequest(request(payload(), options), env, START);
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
    }
    assert.equal((await handleRequest(new Request('https://counter.example/comments'), env, START)).status, 403);
    assert.equal((await handleRequest(request(null, { method: 'DELETE' }), env, START)).status, 405);
});

test('concurrent distinct submissions from one IP admit exactly one and observe the 60-second boundary', async t => {
    const { db, env } = fixture(t);
    const responses = await Promise.all(Array.from({ length: 20 }, () => send(env, payload())));
    assert.equal(responses.filter(result => result.response.status === 201).length, 1);
    const denied = responses.filter(result => result.response.status === 429);
    assert.equal(denied.length, 19);
    assert.ok(denied.every(result => result.response.headers.get('Retry-After') === '60' && result.json.code === 'RATE_LIMITED'));
    const almost = await send(env, payload(), START + 59999);
    assert.equal(almost.response.status, 429);
    assert.equal(almost.response.headers.get('Retry-After'), '1');
    assert.equal((await send(env, payload(), START + 60000)).response.status, 201);
    assert.equal((await send(env, payload(), START, { headers: { 'CF-Connecting-IP': '203.0.113.2' } })).response.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 3);
});

test('five-per-24-hours is a rolling limit across midnight; expired tokens disappear but comments persist', async t => {
    const { db, env } = fixture(t);
    for (let i = 0; i < 5; i++) assert.equal((await send(env, payload(), START + i * 60000)).response.status, 201);
    const denied = await send(env, payload(), START + 5 * 60000);
    assert.equal(denied.response.status, 429);
    assert.equal(denied.response.headers.get('Retry-After'), String((WINDOW_MS - 5 * 60000) / 1000));
    assert.equal((await send(env, payload(), START + WINDOW_MS - 1)).response.headers.get('Retry-After'), '1');
    assert.equal((await send(env, payload(), START + WINDOW_MS)).response.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 6);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 5);
    assert.equal((await send(env, payload(), START + WINDOW_MS + 60000)).response.status, 201);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 7);
});

test('idempotent concurrent retries return the original comment and consume one slot, even after token expiry', async t => {
    const { db, env } = fixture(t);
    const body = payload();
    const results = await Promise.all(Array.from({ length: 15 }, () => send(env, body)));
    assert.equal(results.filter(result => result.response.status === 201).length, 1);
    assert.equal(results.filter(result => result.response.status === 200).length, 14);
    assert.ok(results.every(result => JSON.stringify(result.json) === JSON.stringify(results[0].json)));
    const retry = await send(env, { ...body, requestId: body.requestId.toUpperCase() }, START + 1, { headers: { 'CF-Connecting-IP': '198.51.100.5' } });
    assert.equal(retry.response.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 1);
    const expired = await send(env, body, START + WINDOW_MS);
    assert.equal(expired.response.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 0);
});

test('reusing a request ID with different content returns 409 without editing or consuming quota', async t => {
    const { db, env } = fixture(t);
    const original = payload({ nickname: 'Anonymous' });
    assert.equal((await send(env, original)).response.status, 201);
    for (const changed of [{ message: 'Another comment' }, { nickname: 'Someone else' }, { avatar: 'robot' }, { anonymous: true }]) {
        const result = await send(env, { ...original, ...changed }, START + 60000);
        assert.equal(result.response.status, 409);
        assert.equal(result.json.code, 'REQUEST_ID_CONFLICT');
        assert.equal(result.json.comment, undefined);
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 1);
    assert.equal(db.prepare('SELECT message FROM comments').get().message, original.message);
});

test('IP-derived tokens are domain-separated, never returned, and comment failures roll back admission', async t => {
    const { db, env } = fixture(t);
    const result = await send(env, payload());
    const rate = db.prepare('SELECT token FROM comment_rate_tokens').get();
    assert.match(rate.token, /^[a-f0-9]{64}$/);
    assert.notEqual(rate.token, await hashIp('203.0.113.1', env.VISITOR_HASH_SECRET));
    assert.equal(rate.token, await hashIp('comments:203.0.113.1', env.VISITOR_HASH_SECRET));
    assert.ok(!JSON.stringify(result.json).includes(rate.token));
    assert.ok(!JSON.stringify(result.json).includes('203.0.113.1'));
    assert.deepEqual(db.prepare('PRAGMA table_info(comments)').all().map(row => row.name), ['id', 'nickname', 'anonymous', 'avatar', 'message', 'created_at']);
    const batch = env.COUNTER_DB.batch;
    env.COUNTER_DB.batch = statements => batch([...statements, env.COUNTER_DB.prepare('SELECT missing_column FROM comments')]);
    const failed = await send(env, payload(), START + WINDOW_MS);
    assert.equal(failed.response.status, 503);
    assert.deepEqual(failed.json, { error: 'Comments are unavailable.', code: 'COMMENTS_UNAVAILABLE' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 1);
    assert.equal(db.prepare('SELECT token FROM comment_rate_tokens').get().token, rate.token);
});

test('missing secrets and client addresses fail closed, while reads do not require secrets', async t => {
    const { db, env } = fixture(t);
    assert.equal((await send({ ...env, VISITOR_HASH_SECRET: '' }, payload())).response.status, 503);
    assert.equal((await send({ ...env, VISITOR_HASH_SECRET: '' }, null, START, { method: 'GET' })).response.status, 200);
    const missingIp = request();
    missingIp.headers.delete('CF-Connecting-IP');
    assert.equal((await handleRequest(missingIp, env, START)).status, 400);
    assert.equal((await send(env, payload(), START, { headers: { 'CF-Connecting-IP': 'invalid' } })).response.status, 400);
    assert.equal((await send({}, payload())).response.status, 503);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
});

test('comments and visitor counting coexist without sharing quotas or changing visitor counts', async t => {
    const { db, env } = fixture(t);
    const comment = await send(env, payload());
    assert.equal(comment.response.status, 201);
    const first = await handleRequest(request(null, { path: '/visit' }), env, START);
    assert.equal((await first.json()).total, 1);
    const repeated = await handleRequest(request(null, { path: '/visit' }), env, START + 1);
    assert.equal(repeated.status, 200);
    const publicComments = await worker.fetch(request(null, { method: 'GET' }), env);
    assert.equal(publicComments.status, 200);
    const stats = await handleRequest(request(null, { path: '/stats', method: 'GET' }), env, START);
    assert.equal((await stats.json()).total, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comment_rate_tokens').get().n, 1);
});
