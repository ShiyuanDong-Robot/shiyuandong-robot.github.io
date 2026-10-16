(() => {
    'use strict';

    const root = document.documentElement;
    const toggle = document.querySelector('.puppy-cursor-toggle');
    if (!toggle) return;
    const preview = toggle.querySelector('img');
    const capability = matchMedia('(any-hover: hover) and (any-pointer: fine)');
    const storageKey = 'homepage-puppy-cursor';
    const moods = ['idle', 'happy', 'study', 'stars', 'love', 'wave', 'wink'];
    const nativeFields = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select, [contenteditable]:not([contenteditable=false]), [data-native-cursor]';
    let enabled = true;
    let ready = false;
    let hovering = null;
    let reactionTimer = 0;
    let blankClicks = 0;
    let mood = 'idle';
    let lastReaction = '';
    try { enabled = localStorage.getItem(storageKey) !== 'off'; } catch { /* Storage is optional. */ }

    function setMood(next) {
        if (mood === next) return;
        mood = next;
        root.dataset.puppyMood = next;
        preview.src = `images/cursor/maltese-${next}.svg`;
    }

    function stop() {
        root.classList.remove('puppy-cursor-on');
        clearTimeout(reactionTimer);
        reactionTimer = 0;
        hovering = null;
        setMood('idle');
    }

    function syncPreference() {
        toggle.hidden = !capability.matches || !ready;
        toggle.setAttribute('aria-pressed', String(enabled));
        toggle.title = `${enabled ? 'Turn off' : 'Turn on'} the Maltese (线条小狗) cursor · ©MALTESE / Moonlab`;
        if (!enabled || !capability.matches) stop();
    }

    function category(target, clicked = false) {
        if (!(target instanceof Element)) return 'idle';
        if (!clicked) return target.closest('a, button, summary, label, [role=button]') ? 'happy' : 'idle';
        if (target.closest('.pub-media, .video-float, video')) return 'stars';
        if (target.closest('.moment-photo, #moments, #moments-dialog, .portrait-frame')) return 'love';
        if (target.closest('#guestbook, .social-links, #wechat-dialog')) return 'wave';
        if (target.closest('#publications, #venues, #selected-service')) return 'study';
        const link = target.closest('a[href^="#"]');
        const destination = link?.getAttribute('href');
        if (destination === '#moments') return 'love';
        if (destination === '#guestbook') return 'wave';
        if (['#publications', '#venues', '#selected-service'].includes(destination)) return 'study';
        if (target.closest('a, button, summary, label, [role=button]')) return clicked ? 'wink' : 'happy';
        return clicked ? ['happy', 'wink', 'love', 'wave'][blankClicks++ % 4] : 'idle';
    }

    function track(event) {
        if (event.pointerType !== 'mouse' || !enabled || !ready || !capability.matches ||
            document.fullscreenElement || document.pointerLockElement) {
            stop();
            return false;
        }
        hovering = event.target instanceof Element ? event.target : null;
        root.classList.add('puppy-cursor-on');
        if (!reactionTimer) setMood(category(hovering));
        return true;
    }

    toggle.addEventListener('click', () => {
        enabled = !enabled;
        try { localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch { /* Storage is optional. */ }
        syncPreference();
    });

    // Delegation also covers photos and guestbook controls created after page load.
    document.addEventListener('pointerover', track, { passive: true });
    document.addEventListener('pointermove', track, { passive: true });
    document.addEventListener('pointerdown', event => {
        if (!track(event) || event.button !== 0 || hovering?.closest(nativeFields) ||
            hovering?.closest('.puppy-cursor-toggle, :disabled, [aria-disabled=true]')) return;
        clearTimeout(reactionTimer);
        const preferred = category(hovering, true);
        const alternate = { study: 'stars', stars: 'happy', love: 'wink', wave: 'love', wink: 'happy', happy: 'wave' };
        lastReaction = [preferred, alternate[preferred], 'love', 'wave', 'stars', 'wink', 'study', 'happy']
            .find(next => next && next !== mood && next !== lastReaction);
        setMood(lastReaction);
        reactionTimer = window.setTimeout(() => {
            reactionTimer = 0;
            setMood(category(hovering));
        }, 2000);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', stop, { passive: true });
    document.addEventListener('pointercancel', stop, { passive: true });
    document.addEventListener('keydown', event => { if (event.key === 'Tab' || event.key === 'Escape') stop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    document.addEventListener('fullscreenchange', stop);
    document.addEventListener('pointerlockchange', stop);
    window.addEventListener('blur', stop);
    capability.addEventListener('change', syncPreference);

    // Keep the system cursor until every tiny local sprite has loaded successfully.
    Promise.all(moods.map(name => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = `images/cursor/maltese-${name}.svg`;
    }))).then(() => {
        ready = true;
        root.dataset.puppyMood = mood;
        syncPreference();
    }).catch(stop);
})();
