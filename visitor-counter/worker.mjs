export const WINDOW_MS = 24 * 60 * 60 * 1000;
const SITE_ORIGIN = 'https://shiyuandong-robot.github.io';
const TIME_ZONE = 'Asia/Shanghai';

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

function reply(body, status, origin) {
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Vary': 'Origin',
        'X-Content-Type-Options': 'nosniff'
    };
    if (origin === SITE_ORIGIN) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        headers['Access-Control-Max-Age'] = '86400';
    }
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

export async function handleRequest(request, env, now = Date.now()) {
    const { pathname } = new URL(request.url);
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
