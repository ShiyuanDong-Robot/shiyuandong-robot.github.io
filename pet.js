(() => {
    'use strict';
    const host = document.getElementById('pet-companion');
    if (!host) return;
    const storageKey = 'homepage-maltese-pet-v1';
    const sleepRecoveryPerMinute = 3;
    const wide = matchMedia('(min-width: 1680px)');
    const clamp = value => Math.max(0, Math.min(100, value));
    const icons = {
        pet: '<path d="M20.5 4.5a5 5 0 0 0-7 0L12 6l-1.5-1.5a5 5 0 0 0-7 7L12 20l8.5-8.5a5 5 0 0 0 0-7Z"/>',
        feed: '<path d="M16 3a5 5 0 0 0 5 5 9 9 0 1 1-5-5Z"/><path d="M7 10h.01M12 14h.01M8 16h.01M15 9h.01" stroke-width="3"/>',
        play: '<circle cx="12" cy="12" r="9"/><path d="M5 5c8 1 13 6 14 14M4 18c1-7 6-12 14-14"/>',
        nap: '<path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>',
        trick: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
        chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2A8.5 8.5 0 0 1 21 11.5Z"/><path d="M7 11h.01M12 11h.01M17 11h.01" stroke-width="2.5"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        edit: '<path d="m15 4 5 5-10 10-6 1 1-6ZM13 6l5 5"/>'
    };
    const svg = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
    const pick = items => items[Math.floor(Math.random() * items.length)];
    let state = { name: 'Maltese', joy: 78, energy: 82, bond: 0, sleeping: false, updated: Date.now(), collapsed: false };
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));
        if (saved && typeof saved === 'object') {
            if (typeof saved.name === 'string' && saved.name.trim()) state.name = saved.name.trim().slice(0, 16);
            for (const key of ['joy', 'energy', 'bond']) {
                if (Number.isFinite(saved[key])) state[key] = key === 'bond' ? Math.max(0, Math.min(100000, saved[key])) : clamp(saved[key]);
            }
            state.sleeping = saved.sleeping === true;
            state.collapsed = saved.collapsed === true;
            if (Number.isFinite(saved.updated)) {
                const hours = Math.min(12, Math.max(0, (Date.now() - saved.updated) / 3600000));
                state.energy = clamp(state.energy + (state.sleeping ? hours * 60 * sleepRecoveryPerMinute : -Math.min(20, hours * 2)));
            }
        }
    } catch { /* A private browsing session can still play without saved state. */ }

    host.innerHTML = `
        <section class="pet-panel" id="pet-panel" aria-labelledby="pet-name" hidden>
            <div class="pet-heading">
                <div><p class="pet-eyebrow">A LITTLE COMPANY</p><div class="pet-name-row"><span id="pet-name" class="pet-name"></span><button type="button" class="pet-icon-button" data-pet-rename aria-label="Rename your pet" title="Give me a name">${svg('edit')}</button></div></div>
                <button type="button" class="pet-icon-button" data-pet-close aria-label="Minimize pet" title="Minimize">${svg('close')}</button>
            </div>
            <form class="pet-rename" hidden><input aria-label="Pet name" maxlength="16" autocomplete="off" placeholder="A name for your friend"><button type="submit">Save</button></form>
            <p class="pet-speech" role="status" aria-live="polite" aria-atomic="true"></p>
            <div class="pet-stage" data-animation="idle">
                <button type="button" class="pet-dog" aria-label="Pet Maltese"><img src="images/pet/maltese-idle.svg" width="128" height="128" alt="" draggable="false"></button>
                <span class="pet-prop" aria-hidden="true"></span>
                <button type="button" class="pet-ball" aria-label="Catch the ball" hidden><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#f5c170" stroke="#b98947" stroke-width="1.5"/><path d="M9 7c2 12 12 22 24 24M7 31c13-2 23-12 24-24" fill="none" stroke="#fff5dd" stroke-width="3"/></svg></button>
            </div>
            <p class="pet-bond"><span aria-hidden="true">♡</span><span data-pet-bond>New friends</span></p>
            <div class="pet-meters">
                <div><label class="pet-meter-label" for="pet-joy">Happiness <output data-pet-joy></output></label><progress id="pet-joy" class="pet-meter" max="100" value="78">78%</progress></div>
                <div><label class="pet-meter-label" for="pet-energy">Energy <output data-pet-energy></output></label><progress id="pet-energy" class="pet-meter" max="100" value="82">82%</progress></div>
            </div>
            <div class="pet-actions" role="group" aria-label="Play with your pet">
                ${[['pet','Pet'],['feed','Treat'],['play','Play ball'],['nap','Nap'],['trick','Trick'],['chat','Say hi']].map(([key, label]) => `<button type="button" class="pet-action" data-pet-action="${key}"${['nap','chat'].includes(key) ? ' aria-pressed="false"' : ''}>${svg(key)}<span>${label}</span></button>`).join('')}
            </div>
            <div class="pet-chat" role="group" aria-label="Say something to your pet" hidden>
                <button type="button" data-pet-say="hello">Hello, little friend!</button>
                <button type="button" data-pet-say="break">I could use a little break.</button>
                <button type="button" data-pet-say="night">Good night, sleep tight.</button>
            </div>
            <p class="pet-credit"><a href="https://store.line.me/stickershop/author/173491/th?page=2" target="_blank" rel="noopener noreferrer">Artwork ©MALTESE / Moonlab</a></p>
        </section>
        <button type="button" class="pet-launcher" aria-controls="pet-panel" aria-expanded="false"><img src="images/pet/maltese-wave.svg" width="40" height="40" alt=""><span>Meet Maltese</span></button>`;
    const panel = host.querySelector('.pet-panel');
    const launcher = host.querySelector('.pet-launcher');
    const stage = host.querySelector('.pet-stage');
    const dog = host.querySelector('.pet-dog');
    const sprite = dog.querySelector('img');
    const prop = host.querySelector('.pet-prop');
    const speech = host.querySelector('.pet-speech');
    const chat = host.querySelector('.pet-chat');
    const rename = host.querySelector('.pet-rename');
    const ball = host.querySelector('.pet-ball');
    const napButton = host.querySelector('[data-pet-action="nap"]');
    const chatButton = host.querySelector('[data-pet-action="chat"]');
    let open = false;
    let timer = 0;
    let catches = 0;
    let playing = false;
    let pats = 0;
    let lastAction = 0;
    let lastInteraction = Date.now();
    let lastTick = Date.now();

    function save() {
        state.updated = Date.now();
        try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Saving is optional. */ }
    }
    function renderStats() {
        host.querySelector('.pet-name').textContent = state.name;
        launcher.querySelector('span').textContent = open ? 'My little friend' : `Meet ${state.name}`;
        dog.setAttribute('aria-label', `${state.sleeping ? 'Wake' : 'Pet'} ${state.name}`);
        for (const [key, selector] of [['joy', 'joy'], ['energy', 'energy']]) {
            const value = Math.round(state[key]);
            host.querySelector(`#pet-${selector}`).value = value;
            host.querySelector(`#pet-${selector}`).textContent = `${value}%`;
            host.querySelector(`[data-pet-${selector}]`).textContent = `${value}%`;
        }
        const bondLevel = state.bond >= 30 ? 3 : state.bond >= 10 ? 2 : state.bond >= 3 ? 1 : 0;
        host.querySelector('[data-pet-bond]').textContent = ['New friends', 'Getting closer', 'Good friends', 'Best buddies'][bondLevel];
        host.querySelector('.pet-bond span').textContent = ['♡ ♡ ♡', '♥ ♡ ♡', '♥ ♥ ♡', '♥ ♥ ♥'][bondLevel];
        napButton.querySelector('span').textContent = state.sleeping ? 'Wake up' : 'Nap';
        napButton.setAttribute('aria-pressed', String(state.sleeping));
    }
    function mood(name, animation = 'idle', accessory = '') {
        sprite.src = `images/pet/maltese-${name}.svg`;
        stage.dataset.animation = '';
        // Restart a short CSS reaction even when the same action is repeated.
        void stage.offsetWidth;
        stage.dataset.animation = animation;
        prop.textContent = accessory;
    }
    function resting() {
        mood(state.sleeping ? 'study' : 'idle', state.sleeping ? 'sleep' : 'idle', state.sleeping ? 'z z' : '');
        speech.textContent = state.sleeping ? 'Zzz… wake me when you want to play.' : 'A little head pat? Tap me!';
    }
    function stopGame() {
        if (document.activeElement === ball) host.querySelector('[data-pet-action="play"]').focus({ preventScroll: true });
        playing = false;
        catches = 0;
        ball.hidden = true;
    }
    function closeChat() {
        chat.hidden = true;
        chatButton.setAttribute('aria-pressed', 'false');
    }
    function startAction() {
        clearTimeout(timer);
        timer = 0;
        stopGame();
        closeChat();
        lastInteraction = Date.now();
    }
    function react(image, message, animation = 'pet', accessory = '', duration = 4200) {
        mood(image, animation, accessory);
        speech.textContent = message;
        clearTimeout(timer);
        timer = window.setTimeout(() => { timer = 0; resting(); }, duration);
    }
    function reward(joy = 4, energy = 0) {
        state.joy = clamp(state.joy + joy);
        state.energy = clamp(state.energy + energy);
        state.bond += 1;
        renderStats();
        save();
    }
    function wake() {
        state.sleeping = false;
        lastTick = Date.now();
        reward(3, 0);
        react('happy', 'Good morning! Ready for another little adventure?', 'bounce', '☀');
    }
    function nap() {
        startAction();
        if (state.sleeping) return wake();
        state.sleeping = true;
        lastTick = Date.now();
        reward(2, 4);
        resting();
    }
    function setOpen(next, remember = false) {
        open = next;
        panel.hidden = !open;
        host.dataset.open = String(open);
        launcher.setAttribute('aria-expanded', String(open));
        if (remember && wide.matches) { state.collapsed = !open; save(); }
        if (!open) { startAction(); resting(); rename.hidden = true; }
        renderStats();
    }
    function act(action) {
        const now = Date.now();
        if (now - lastAction < 250) return;
        lastAction = now;
        const chatWasOpen = !chat.hidden;
        startAction();
        if (action === 'nap') return nap();
        if (state.sleeping) {
            if (action === 'pet') return wake();
            speech.textContent = 'One more tiny snooze… tap me to wake up.';
            return;
        }
        if (action === 'pet') {
            pats += 1;
            reward(6);
            react(pats % 3 ? 'love' : 'wink', pats % 3 ? pick(['That is the spot. More, please!', 'Head pats make everything better.', 'My favourite human has arrived!']) : 'Three pats! Sending a little love back.', 'pet', '♡');
        } else if (action === 'feed') {
            if (state.energy >= 96) {
                react('love', 'My tummy is full. Saving this treat for later!', 'pet', '♡');
            } else {
                reward(5, 16);
                react('happy', pick(['Crunch, crunch… a five-star biscuit!', 'A treat for me? You know me so well.', 'Snack accepted. Tail-wagging activated!']), 'feed', '🍪');
            }
        } else if (action === 'play') {
            if (state.energy < 12) return react('study', 'A tiny rest or a biscuit, then let’s play!', 'bow');
            playing = true;
            ball.hidden = false;
            ball.style.left = '72%'; ball.style.top = '18%';
            mood('happy', 'play');
            speech.textContent = 'Help me catch the ball! Tap it three times. 0/3';
        } else if (action === 'trick') {
            if (state.energy < 8) return react('study', 'My paws need a little break. Nap time?', 'bow');
            reward(6, -5);
            const trick = pick([
                ['happy', 'One happy hop, just for you!', 'bounce', '✦'],
                ['wave', 'Ta-da! My very best little bow.', 'bow', '✧'],
                ['wink', 'A little spin and a whole lot of love.', 'spin', '♡']
            ]);
            react(...trick);
        } else if (action === 'chat') {
            chat.hidden = chatWasOpen;
            chatButton.setAttribute('aria-pressed', String(!chat.hidden));
            if (!chat.hidden) { mood('wave', 'pet'); speech.textContent = 'I am all ears. What is on your mind?'; }
            else resting();
        }
    }
    host.addEventListener('click', event => {
        const action = event.target.closest('[data-pet-action]');
        if (action) act(action.dataset.petAction);
        const phrase = event.target.closest('[data-pet-say]');
        if (phrase) {
            // Keep focus on a visible control when the choice buttons disappear.
            chatButton.focus({ preventScroll: true });
            startAction();
            if (phrase.dataset.petSay === 'night') return nap();
            reward(5);
            if (phrase.dataset.petSay === 'break') react('love', 'Come sit with me. Relax your shoulders and take a slow breath.', 'pet', '♡', 7000);
            else react('wave', `Hello! I’m ${state.name}. Very happy to meet you!`, 'bounce', '♡');
        }
    });
    dog.addEventListener('click', () => act('pet'));
    ball.addEventListener('click', () => {
        if (!playing) return;
        catches += 1;
        lastInteraction = Date.now();
        if (catches >= 3) {
            stopGame();
            reward(12, -8);
            react('stars', 'Three out of three! We make a great team.', 'bounce', '✦', 5500);
        } else {
            const position = catches === 1 ? ['7%', '39%'] : ['67%', '6%'];
            ball.style.left = position[0]; ball.style.top = position[1];
            speech.textContent = `${catches === 1 ? 'Got it! Over here now.' : 'So close! One more catch.'} ${catches}/3`;
        }
    });
    launcher.addEventListener('click', () => {
        setOpen(!open, true);
        if (open) { resting(); host.querySelector('[data-pet-close]').focus({ preventScroll: true }); }
    });
    host.querySelector('[data-pet-close]').addEventListener('click', () => {
        setOpen(false, true); launcher.focus({ preventScroll: true });
    });
    host.addEventListener('keydown', event => {
        if (event.key === 'Escape' && open) {
            event.stopPropagation(); setOpen(false, true); launcher.focus({ preventScroll: true });
        }
    });
    host.querySelector('[data-pet-rename]').addEventListener('click', () => {
        rename.hidden = !rename.hidden;
        if (!rename.hidden) { rename.querySelector('input').value = state.name; rename.querySelector('input').focus({ preventScroll: true }); }
    });
    rename.addEventListener('submit', event => {
        event.preventDefault();
        const name = rename.querySelector('input').value.trim().slice(0, 16);
        if (!name) { rename.querySelector('input').focus(); return; }
        state.name = name;
        rename.hidden = true;
        host.querySelector('[data-pet-rename]').focus({ preventScroll: true });
        startAction(); renderStats(); save();
        if (state.sleeping) resting();
        else react('love', `${name}… I love my new name!`, 'pet', '♡');
    });
    wide.addEventListener('change', () => {
        const hadFocus = host.contains(document.activeElement);
        setOpen(wide.matches && !state.collapsed);
        if (!open && hadFocus) launcher.focus({ preventScroll: true });
        else if (open && hadFocus) host.querySelector('[data-pet-close]').focus({ preventScroll: true });
    });
    document.addEventListener('visibilitychange', () => {
        host.dataset.paused = String(document.hidden);
    });
    // A lightweight clock: sleep restores energy, and an open pet occasionally greets you.
    window.setInterval(() => {
        const now = Date.now();
        const elapsed = Math.min(3600000, Math.max(0, now - lastTick));
        lastTick = now;
        if (state.sleeping) { state.energy = clamp(state.energy + elapsed / 60000 * sleepRecoveryPerMinute); renderStats(); save(); }
        if (!open || document.hidden || state.sleeping || playing || timer || !chat.hidden || !rename.hidden || now - lastInteraction < 60000) return;
        lastInteraction = now;
        react('wave', pick(['Just keeping you company. Take your time.', 'A stretch break? I will join you!', 'Still here, being a very good little dog.']), 'pet', '', 5000);
    }, 20000);
    resting(); renderStats(); setOpen(wide.matches && !state.collapsed);
    host.hidden = false;
})();
