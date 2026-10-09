'use strict';

(() => {
    const TIMEOUT_MS = 20000;
    const RETRY_DELAYS = [2000, 8000, 30000];
    const endpoints = ['visitor-counter-endpoint', 'homepage-api-fallback'].map(name => {
        const value = document.querySelector(`meta[name="${name}"]`)?.content.trim();
        if (!value) return null;
        try {
            const url = new URL(value);
            const local = url.protocol === 'http:' && url.hostname === '127.0.0.1';
            if ((url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash) return null;
            url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
            return url.href;
        } catch (_) { return null; }
    }).filter((value, index, values) => value && values.indexOf(value) === index);
    let preferred = 0;

    function abortError() {
        const error = new Error('Request cancelled.');
        error.name = 'AbortError';
        return error;
    }

    async function request(path, { method = 'GET', body, signal } = {}) {
        if (!endpoints.length) throw new Error('The API is not configured.');
        // Serialize once: an uncertain POST must use the same idempotency key at every endpoint.
        const serialized = body === undefined ? undefined : JSON.stringify(body);
        const order = endpoints.map((_, index) => (preferred + index) % endpoints.length);
        let lastError;
        for (const index of order) {
            if (signal?.aborted) throw abortError();
            const controller = new AbortController();
            const cancel = () => controller.abort();
            signal?.addEventListener('abort', cancel, { once: true });
            const timeout = setTimeout(cancel, TIMEOUT_MS);
            try {
                const headers = { Accept: 'application/json' };
                if (serialized !== undefined) headers['Content-Type'] = 'application/json';
                const response = await fetch(new URL(path, endpoints[index]).href, {
                    method, body: serialized, headers, signal: controller.signal,
                    credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
                    cache: 'no-store', redirect: 'error'
                });
                if (response.status >= 500) throw new Error('The API is temporarily unavailable.');
                let data = null;
                try { data = await response.json(); }
                catch (error) { if (response.ok || controller.signal.aborted) throw error; }
                preferred = index;
                // Validation errors and rate limits belong to the shared backend, not the transport.
                return { response, data };
            } catch (error) {
                if (signal?.aborted) throw abortError();
                lastError = error;
            } finally {
                clearTimeout(timeout);
                signal?.removeEventListener('abort', cancel);
            }
        }
        throw lastError || new Error('The API could not be reached.');
    }

    function createRecovery(retry) {
        let failed = false;
        let attempt = 0;
        let timer = null;
        const visibleAndOnline = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
        function pending() { failed = false; clearTimeout(timer); timer = null; }
        function succeeded() { pending(); attempt = 0; }
        function run() {
            timer = null;
            if (!failed || !visibleAndOnline()) return;
            failed = false;
            retry();
        }
        function failure() {
            failed = true;
            clearTimeout(timer);
            if (attempt < RETRY_DELAYS.length) timer = setTimeout(run, RETRY_DELAYS[attempt++]);
        }
        function recover() {
            if (!failed || !visibleAndOnline()) return;
            clearTimeout(timer);
            attempt = 0;
            run();
        }
        window.addEventListener('online', recover);
        window.addEventListener('pageshow', recover);
        document.addEventListener('visibilitychange', recover);
        return { pending, succeeded, failed: failure, restart: () => { attempt = 0; } };
    }

    function createRequestId() {
        if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }

    window.HomepageApi = {
        available: endpoints.length > 0 && typeof fetch === 'function' && typeof AbortController === 'function',
        canCreateRequestId: typeof globalThis.crypto?.getRandomValues === 'function',
        request, createRecovery, createRequestId
    };
})();
