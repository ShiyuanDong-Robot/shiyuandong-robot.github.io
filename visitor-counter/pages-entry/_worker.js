const SITE_ORIGIN = 'https://shiyuandong-robot.github.io';
const PREVIEW_ORIGIN = 'http://127.0.0.1:8765';
const API_PATHS = new Set(['/comments', '/visit', '/stats']);

function reply(request, body, status, extra = {}) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const previewRead = url.pathname === '/comments' && origin === PREVIEW_ORIGIN &&
        (request.method === 'GET' || (request.method === 'OPTIONS' &&
            request.headers.get('Access-Control-Request-Method') === 'GET'));
    const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Vary': 'Origin',
        'X-Content-Type-Options': 'nosniff',
        ...extra
    };
    if (origin === SITE_ORIGIN || previewRead) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = previewRead ? 'GET, OPTIONS' : 'GET, POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
        headers['Access-Control-Expose-Headers'] = 'Retry-After';
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers });
}

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (pathname === '/') {
            if (!['GET', 'HEAD'].includes(request.method)) {
                return reply(request, { error: 'Method not allowed.' }, 405, { Allow: 'GET, HEAD' });
            }
            // Reachability only: never expose visitors, comments, addresses, or bindings.
            return reply(request, { ok: true }, 200);
        }
        if (!API_PATHS.has(pathname)) return reply(request, { error: 'Not found.' }, 404);
        if (!env.HOMEPAGE_API || typeof env.HOMEPAGE_API.fetch !== 'function') {
            return reply(request, { error: 'Service temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' }, 503);
        }
        try {
            // Forward the edge Request unchanged through the internal service binding.
            // The original Worker owns CORS, Cloudflare IP validation, deduplication,
            // and comment rate limits. Never synthesize Origin or client IP headers.
            return await env.HOMEPAGE_API.fetch(request);
        } catch (_) {
            // No public-fetch fallback, request logging, or disclosure of binding details.
            return reply(request, { error: 'Service temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' }, 503);
        }
    }
};
