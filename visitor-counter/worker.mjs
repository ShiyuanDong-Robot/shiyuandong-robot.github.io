export const WINDOW_MS = 24 * 60 * 60 * 1000;
const SITE_ORIGIN = 'https://shiyuandong-robot.github.io';
const TIME_ZONE = 'Asia/Shanghai';
const PREVIEW_ORIGIN = 'http://127.0.0.1:8765';
const COMMENT_INTERVAL_MS = 60 * 1000;
const COMMENT_BODY_LIMIT = 4096;
const AVATARS = new Set(['cat', 'bunny', 'bear', 'panda', 'fox', 'robot']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function dayAt(timestamp) {
    return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const RECORD_VISIT = `
    INSERT INTO visitor_tokens (token, counted_at, counted_day) VALUES (?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
        counted_at = excluded.counted_at,
        counted_day = excluded.counted_day
    WHERE visitor_tokens.counted_at <= excluded.counted_at - ${WINDOW_MS}
`;
const READ_COUNTS = `
    SELECT
        COALESCE((SELECT count FROM visitor_daily WHERE day = ?), 0) AS today,
        (SELECT count FROM visitor_total WHERE id = 1) AS total
`;

function reply(body, status, origin, extraHeaders = {}, allowPreview = false) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Vary': 'Origin',
        'X-Content-Type-Options': 'nosniff'
    };
    if (origin === SITE_ORIGIN || (allowPreview && origin === PREVIEW_ORIGIN)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = origin === PREVIEW_ORIGIN ? 'GET, OPTIONS' : 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
        headers['Access-Control-Expose-Headers'] = 'Retry-After';
        headers['Access-Control-Max-Age'] = '86400';
    }
    Object.assign(headers, extraHeaders);
    return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export async function hashIp(ip, secret) {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

class CommentRequestError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

async function readCommentBody(request) {
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw new CommentRequestError(415, 'JSON_REQUIRED', 'Send an application/json request.');
    }
    if (Number(request.headers.get('Content-Length')) > COMMENT_BODY_LIMIT) {
        throw new CommentRequestError(413, 'BODY_TOO_LARGE', 'The request is too large.');
    }
    if (!request.body) throw new CommentRequestError(400, 'INVALID_JSON', 'Send a valid JSON object.');
    const reader = request.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > COMMENT_BODY_LIMIT) {
                await reader.cancel();
                throw new CommentRequestError(413, 'BODY_TOO_LARGE', 'The request is too large.');
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
        return value;
    } catch (_) {
        throw new CommentRequestError(400, 'INVALID_JSON', 'Send a valid JSON object.');
    }
}

function validateComment(value) {
    if (typeof value.website !== 'string' || value.website !== '') {
        throw new CommentRequestError(400, 'INVALID_SUBMISSION', 'The submission is invalid.');
    }
    if (typeof value.anonymous !== 'boolean') {
        throw new CommentRequestError(400, 'INVALID_ANONYMOUS', 'Choose whether to post anonymously.');
    }
    const nickname = value.anonymous ? 'Anonymous' : (typeof value.nickname === 'string' ? value.nickname.trim() : '');
    if (nickname.includes('\u0000') || Array.from(nickname).length < 1 || Array.from(nickname).length > 24) {
        throw new CommentRequestError(400, 'INVALID_NICKNAME', 'Use a nickname of 1 to 24 characters.');
    }
    const message = typeof value.message === 'string' ? value.message.trim() : '';
    if (message.includes('\u0000') || Array.from(message).length < 1 || Array.from(message).length > 500) {
        throw new CommentRequestError(400, 'INVALID_MESSAGE', 'Write a message of 1 to 500 characters.');
    }
    if (!AVATARS.has(value.avatar)) {
        throw new CommentRequestError(400, 'INVALID_AVATAR', 'Choose an available avatar.');
    }
    if (typeof value.requestId !== 'string' || !UUID.test(value.requestId)) {
        throw new CommentRequestError(400, 'INVALID_REQUEST_ID', 'Send a valid request ID.');
    }
    return { id: value.requestId.toLowerCase(), nickname, anonymous: value.anonymous, avatar: value.avatar, message };
}

function publicComment(row) {
    return { id: row.id, nickname: row.nickname, avatar: row.avatar, message: row.message, createdAt: new Date(row.created_at).toISOString() };
}

async function handleComments(request, env, now) {
    const origin = request.headers.get('Origin');
    const previewRead = origin === PREVIEW_ORIGIN && (request.method === 'GET' ||
        (request.method === 'OPTIONS' && request.headers.get('Access-Control-Request-Method') === 'GET'));
    const respond = (body, status = 200, headers = {}) => reply(body, status, origin, headers, previewRead);
    if (origin !== SITE_ORIGIN && !previewRead) {
        return reply({ error: 'Origin not allowed.', code: 'ORIGIN_NOT_ALLOWED' }, 403, null);
    }
    if (request.method === 'OPTIONS') return respond(null, 204);
    if (!['GET', 'POST'].includes(request.method)) {
        return respond({ error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (!env.COUNTER_DB) return respond({ error: 'Comments are unavailable.', code: 'COMMENTS_UNAVAILABLE' }, 503);
    try {
        if (request.method === 'GET') {
            const results = await env.COUNTER_DB.batch([
                env.COUNTER_DB.prepare('SELECT id, nickname, avatar, message, created_at FROM comments ORDER BY created_at DESC, id DESC LIMIT 3'),
                env.COUNTER_DB.prepare('SELECT COUNT(*) AS total FROM comments')
            ]);
            return respond({ comments: results[0].results.map(publicComment), total: results[1].results[0].total });
        }
        const comment = validateComment(await readCommentBody(request));
        if (typeof env.VISITOR_HASH_SECRET !== 'string' || env.VISITOR_HASH_SECRET.length < 32) {
            return respond({ error: 'Comments are unavailable.', code: 'COMMENTS_UNAVAILABLE' }, 503);
        }
        const ip = request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP');
        if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) {
            return respond({ error: 'Client address unavailable.', code: 'CLIENT_ADDRESS_UNAVAILABLE' }, 400);
        }
        const token = await hashIp(`comments:${ip.toLowerCase()}`, env.VISITOR_HASH_SECRET);
        // Admission and publication are one transaction. Only the expiring rate
        // table links a request ID to an IP-derived token; public comments do not.
        const results = await env.COUNTER_DB.batch([
            env.COUNTER_DB.prepare('DELETE FROM comment_rate_tokens WHERE created_at <= ?').bind(now - WINDOW_MS),
            env.COUNTER_DB.prepare(`
                INSERT INTO comment_rate_tokens (request_id, token, created_at)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (SELECT 1 FROM comments WHERE id = ?)
                  AND NOT EXISTS (SELECT 1 FROM comment_rate_tokens WHERE token = ? AND created_at > ?)
                  AND (SELECT COUNT(*) FROM comment_rate_tokens WHERE token = ? AND created_at > ?) < 5
                ON CONFLICT(request_id) DO NOTHING
            `).bind(comment.id, token, now, comment.id, token, now - COMMENT_INTERVAL_MS, token, now - WINDOW_MS),
            env.COUNTER_DB.prepare(`
                INSERT INTO comments (id, nickname, anonymous, avatar, message, created_at)
                SELECT ?, ?, ?, ?, ?, ?
                WHERE EXISTS (SELECT 1 FROM comment_rate_tokens WHERE request_id = ? AND token = ? AND created_at = ?)
                ON CONFLICT(id) DO NOTHING
            `).bind(comment.id, comment.nickname, Number(comment.anonymous), comment.avatar, comment.message, now, comment.id, token, now),
            env.COUNTER_DB.prepare('SELECT id, nickname, anonymous, avatar, message, created_at FROM comments WHERE id = ?').bind(comment.id),
            env.COUNTER_DB.prepare('SELECT COUNT(*) AS count, MIN(created_at) AS oldest, MAX(created_at) AS latest FROM comment_rate_tokens WHERE token = ? AND created_at > ?').bind(token, now - WINDOW_MS)
        ]);
        const stored = results[3].results[0];
        if (stored) {
            if (stored.nickname !== comment.nickname || stored.anonymous !== Number(comment.anonymous) ||
                stored.avatar !== comment.avatar || stored.message !== comment.message) {
                return respond({ error: 'This request ID was already used for another comment.', code: 'REQUEST_ID_CONFLICT' }, 409);
            }
            return respond({ comment: publicComment(stored) }, results[2].meta.changes > 0 ? 201 : 200);
        }
        const rate = results[4].results[0];
        const wait = Math.max(rate.count ? rate.latest + COMMENT_INTERVAL_MS - now : 0,
            rate.count >= 5 ? rate.oldest + WINDOW_MS - now : 0);
        if (wait <= 0) throw new Error('Admission failed');
        return respond({ error: 'Please wait before posting another comment.', code: 'RATE_LIMITED' }, 429,
            { 'Retry-After': String(Math.max(1, Math.ceil(wait / 1000))) });
    } catch (error) {
        if (error instanceof CommentRequestError) return respond({ error: error.message, code: error.code }, error.status);
        // Do not log submitted content, client addresses, tokens or secrets.
        return respond({ error: 'Comments are unavailable.', code: 'COMMENTS_UNAVAILABLE' }, 503);
    }
}

export async function handleRequest(request, env, now = Date.now()) {
    const { pathname } = new URL(request.url);
    if (pathname === '/comments') return handleComments(request, env, now);
    const origin = request.headers.get('Origin');
    if (origin !== SITE_ORIGIN) return reply({ error: 'Origin not allowed' }, 403, null);
    if (!['/visit', '/stats'].includes(pathname)) return reply({ error: 'Not found' }, 404, origin);
    if (request.method === 'OPTIONS') return reply(null, 204, origin);
    if ((pathname === '/visit' && request.method !== 'POST') ||
        (pathname === '/stats' && request.method !== 'GET')) {
        return reply({ error: 'Method not allowed' }, 405, origin);
    }
    if (!env.COUNTER_DB || typeof env.VISITOR_HASH_SECRET !== 'string' || env.VISITOR_HASH_SECRET.length < 32) {
        return reply({ error: 'Counter unavailable' }, 503, origin);
    }
    const date = dayAt(now);
    try {
        let counts;
        if (pathname === '/visit') {
            // This header is supplied by Cloudflare, never by browser JavaScript.
            // Use the original IPv6 address when Pseudo IPv4 is enabled.
            const ip = request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP');
            if (!ip || !/^[0-9a-fA-F:.]+$/.test(ip)) return reply({ error: 'Client address unavailable' }, 400, origin);
            const token = await hashIp(ip.toLowerCase(), env.VISITOR_HASH_SECRET);
            // The upsert, trigger increments and reads run in one D1 transaction.
            // Old deduplication tokens are disposable; aggregate counts persist.
            const results = await env.COUNTER_DB.batch([
                env.COUNTER_DB.prepare('DELETE FROM visitor_tokens WHERE counted_at <= ?').bind(now - WINDOW_MS),
                env.COUNTER_DB.prepare(RECORD_VISIT).bind(token, now, date),
                env.COUNTER_DB.prepare(READ_COUNTS).bind(date)
            ]);
            counts = results[2].results[0];
        } else {
            counts = await env.COUNTER_DB.prepare(READ_COUNTS).bind(date).first();
        }
        if (!counts || !Number.isSafeInteger(counts.today) || !Number.isSafeInteger(counts.total)) {
            throw new Error('Invalid counts');
        }
        return reply({ ...counts, date, timeZone: TIME_ZONE }, 200, origin);
    } catch (_) {
        // Never log the request, IP address, token or secret.
        return reply({ error: 'Counter unavailable' }, 503, origin);
    }
}

export default {
    fetch(request, env) { return handleRequest(request, env); }
};
