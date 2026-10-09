'use strict';

(() => {
    const PRODUCTION_HOST = 'shiyuandong-robot.github.io';
    const STATS_REFRESH_MS = 60000;
    const EXPLANATION = 'The same IP is counted once per 24 hours. Daily totals use Beijing time (UTC+8).';
    const panel = document.querySelector('.visitor-counter');
    const today = panel?.querySelector('[data-visitors-today]');
    const total = panel?.querySelector('[data-visitors-total]');
    const api = window.HomepageApi;
    if (!panel || !today || !total) return;

    function showUnavailable(state = 'unavailable') {
        [today, total].forEach(value => {
            value.textContent = '—';
            value.setAttribute('aria-label', 'Unavailable');
        });
        panel.title = EXPLANATION;
        panel.dataset.counterState = state;
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
    if (!api?.available) return;

    const canRecordVisit = window.location.hostname === PRODUCTION_HOST;
    const format = new Intl.NumberFormat('en-US');
    let visitRecorded = false;
    let hasStats = false;
    let requesting = false;
    let lastRequestAt = null;

    async function refreshVisitors(force = false) {
        if (document.visibilityState !== 'visible' || requesting) return;
        const recordVisit = canRecordVisit && !visitRecorded;
        if (!force && !recordVisit && lastRequestAt !== null && Date.now() - lastRequestAt < STATS_REFRESH_MS) return;
        requesting = true;
        recovery.pending();
        lastRequestAt = Date.now();
        try {
            // Both endpoints share the same database and rolling 24-hour IP deduplication.
            const { response, data: stats } = await api.request(recordVisit ? 'visit' : 'stats', { method: recordVisit ? 'POST' : 'GET' });
            if (!response.ok) throw new Error('Visitor statistics request failed.');
            if (!validStats(stats)) throw new Error('Visitor statistics response is invalid.');
            if (recordVisit) visitRecorded = true;
            hasStats = true;
            today.textContent = format.format(stats.today);
            total.textContent = format.format(stats.total);
            today.removeAttribute('aria-label');
            total.removeAttribute('aria-label');
            panel.title = `${EXPLANATION} Statistics date: ${stats.date}.`;
            panel.dataset.counterState = 'ready';
            recovery.succeeded();
        } catch (_) {
            if (hasStats) {
                panel.dataset.counterState = 'stale';
                panel.title = `${EXPLANATION} Showing the last loaded statistics while reconnecting.`;
            } else showUnavailable();
            recovery.failed();
        } finally {
            requesting = false;
        }
    }

    const recovery = api.createRecovery(() => refreshVisitors(true));
    document.addEventListener('visibilitychange', () => refreshVisitors());
    window.addEventListener('pageshow', () => refreshVisitors());
    refreshVisitors();
})();
