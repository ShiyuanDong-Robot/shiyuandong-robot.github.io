'use strict';

(() => {
    const PRODUCTION_HOST = 'shiyuandong-robot.github.io';
    const REQUEST_TIMEOUT_MS = 10000;
    const STATS_REFRESH_MS = 60000;
    const EXPLANATION = 'The same IP is counted once per 24 hours. Daily totals use Beijing time (UTC+8).';
    const panel = document.querySelector('.visitor-counter');
    const today = panel?.querySelector('[data-visitors-today]');
    const total = panel?.querySelector('[data-visitors-total]');
    const configuredEndpoint = document.querySelector('meta[name="visitor-counter-endpoint"]')?.content.trim();
    if (!panel || !today || !total) return;

    function showUnavailable(state = 'unavailable') {
        [today, total].forEach(value => {
            value.textContent = '—';
            value.setAttribute('aria-label', 'Unavailable');
        });
        panel.title = EXPLANATION;
        panel.dataset.counterState = state;
    }

    function readEndpoint(value) {
        if (!value) return null;
        try {
            const endpoint = new URL(value);
            const localTest = endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1';
            if ((endpoint.protocol !== 'https:' && !localTest) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
            endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/`;
            return endpoint;
        } catch (_) {
            return null;
        }
    }

    function validStats(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        if (!Number.isSafeInteger(value.today) || value.today < 0 ||
            !Number.isSafeInteger(value.total) || value.total < value.today || value.timeZone !== 'Asia/Shanghai') return false;
        if (typeof value.date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
        const date = new Date(`${value.date}T00:00:00.000Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.date;
    }

    showUnavailable('not-configured');
    const endpoint = readEndpoint(configuredEndpoint);
    if (!endpoint || typeof fetch !== 'function' || typeof AbortController !== 'function') return;

    const canRecordVisit = window.location.hostname === PRODUCTION_HOST;
    const format = new Intl.NumberFormat('en-US');
    let visitAttempted = false;
    let requesting = false;
    let lastRequestAt = null;

    async function refreshVisitors() {
        if (document.visibilityState !== 'visible' || requesting) return;
        const recordVisit = canRecordVisit && !visitAttempted;
        if (!recordVisit && lastRequestAt !== null && Date.now() - lastRequestAt < STATS_REFRESH_MS) return;
        // A failed registration is never retried by this page; IP deduplication belongs to the server.
        if (recordVisit) visitAttempted = true;
        requesting = true;
        lastRequestAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(new URL(recordVisit ? 'visit' : 'stats', endpoint).href, {
                method: recordVisit ? 'POST' : 'GET',
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                cache: 'no-store',
                redirect: 'error',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            });
            if (!response.ok) throw new Error('Visitor statistics request failed.');
            const stats = await response.json();
            if (!validStats(stats)) throw new Error('Visitor statistics response is invalid.');
            today.textContent = format.format(stats.today);
            total.textContent = format.format(stats.total);
            today.removeAttribute('aria-label');
            total.removeAttribute('aria-label');
            panel.title = `${EXPLANATION} Statistics date: ${stats.date}.`;
            panel.dataset.counterState = 'ready';
        } catch (_) {
            showUnavailable();
        } finally {
            clearTimeout(timeout);
            requesting = false;
        }
    }

    document.addEventListener('visibilitychange', refreshVisitors);
    window.addEventListener('pageshow', refreshVisitors);
    refreshVisitors();
})();
