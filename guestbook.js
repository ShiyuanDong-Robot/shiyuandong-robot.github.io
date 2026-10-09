'use strict';

(() => {
    const mount = document.querySelector('#guestbook');
    if (!mount) return;

    const AVATARS = ['cat', 'bunny', 'bear', 'panda', 'fox', 'robot'];
    const MAX_NICKNAME = 24;
    const MAX_MESSAGE = 500;
    const MAX_COMMENTS = 3;
    const REQUEST_TIMEOUT_MS = 10000;
    const canPost = window.location.origin === 'https://shiyuandong-robot.github.io';
    const configuredEndpoint = document.querySelector('meta[name="visitor-counter-endpoint"]')?.content.trim();
    const endpoint = readEndpoint(configuredEndpoint);
    const canRequest = Boolean(endpoint && typeof fetch === 'function' && typeof AbortController === 'function');
    const canCreateRequestId = typeof globalThis.crypto?.randomUUID === 'function';
    const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
    const fullDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    let busy = false;
    let savedNickname = '';
    let pendingSubmission = null;
    let retryAt = 0;
    let retryTimer = null;
    let listVersion = 0;
    let listController = null;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function readEndpoint(value) {
        if (!value) return null;
        try {
            const url = new URL(value);
            const localEndpoint = url.protocol === 'http:' && url.hostname === '127.0.0.1';
            if ((url.protocol !== 'https:' && !localEndpoint) || url.username || url.password || url.search || url.hash) return null;
            url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
            return url;
        } catch (_) {
            return null;
        }
    }

    function characterCount(value) {
        return Array.from(value).length;
    }

    function validComment(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const validId = (typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128) ||
            (Number.isSafeInteger(value.id) && value.id >= 0);
        if (!validId || !AVATARS.includes(value.avatar)) return false;
        if (typeof value.nickname !== 'string' || !value.nickname.trim() || characterCount(value.nickname) > MAX_NICKNAME) return false;
        if (typeof value.message !== 'string' || !value.message.trim() || characterCount(value.message) > MAX_MESSAGE) return false;
        if (typeof value.createdAt !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.createdAt)) return false;
        const createdAt = new Date(value.createdAt);
        return Number.isFinite(createdAt.getTime()) && createdAt.toISOString().slice(0, 19) === value.createdAt.slice(0, 19);
    }

    function validList(value) {
        return value && typeof value === 'object' && !Array.isArray(value) &&
            Array.isArray(value.comments) && value.comments.length <= MAX_COMMENTS &&
            Number.isSafeInteger(value.total) && value.total >= value.comments.length &&
            value.comments.every(validComment) &&
            new Set(value.comments.map(comment => String(comment.id))).size === value.comments.length;
    }

    const header = element('div', 'guestbook-heading');
    const title = element('h2', '', 'Guestbook');
    title.id = 'guestbook-title';
    const introduction = element('p', 'guestbook-introduction', 'Leave a note. Say hello.');
    header.append(title, introduction);

    const recent = element('section', 'guestbook-recent');
    recent.setAttribute('aria-label', 'Latest guestbook notes');
    const listStatus = element('p', 'guestbook-list-status');
    listStatus.setAttribute('role', 'status');
    listStatus.setAttribute('aria-live', 'polite');
    const list = element('ol', 'guestbook-list');
    const reloadButton = element('button', 'guestbook-retry', 'Try again');
    reloadButton.type = 'button';
    reloadButton.hidden = true;
    recent.append(listStatus, list, reloadButton);

    const form = element('form', 'guestbook-form');
    form.noValidate = true;
    form.setAttribute('aria-label', 'Leave a guestbook note');
    const avatars = element('fieldset', 'guestbook-avatars');
    avatars.append(element('legend', '', 'Choose an avatar'));
    const avatarOptions = element('div', 'guestbook-avatar-options');
    const avatarInputs = AVATARS.map((avatar, index) => {
        const choice = element('label', 'guestbook-avatar-choice');
        const input = element('input');
        input.type = 'radio';
        input.name = 'guestbook-avatar';
        input.value = avatar;
        input.checked = index === 0;
        input.setAttribute('aria-label', `${avatar[0].toUpperCase()}${avatar.slice(1)} avatar`);
        const image = element('img');
        image.src = `images/guestbook/${avatar}.svg`;
        image.alt = '';
        image.width = 32;
        image.height = 32;
        choice.append(input, image);
        avatarOptions.append(choice);
        return input;
    });
    avatars.append(avatarOptions);

    const nicknameLabel = element('label', 'guestbook-field-label', 'Nickname');
    nicknameLabel.htmlFor = 'guestbook-nickname';
    const nickname = element('input', 'guestbook-input');
    nickname.id = 'guestbook-nickname';
    nickname.name = 'nickname';
    nickname.type = 'text';
    nickname.autocomplete = 'nickname';
    nickname.placeholder = 'Your name';
    nickname.required = true;
    const anonymousLabel = element('label', 'guestbook-anonymous');
    const anonymous = element('input');
    anonymous.type = 'checkbox';
    anonymous.name = 'anonymous';
    anonymousLabel.append(anonymous, element('span', '', 'Post anonymously'));

    const messageLabel = element('label', 'guestbook-field-label', 'Your note');
    messageLabel.htmlFor = 'guestbook-message';
    const message = element('textarea', 'guestbook-input guestbook-message');
    message.id = 'guestbook-message';
    message.name = 'message';
    message.rows = 3;
    message.required = true;
    message.placeholder = 'A thought, a question, or a hello…';
    message.setAttribute('aria-describedby', 'guestbook-character-count guestbook-public-note');
    const count = element('span', 'guestbook-character-count', `0 / ${MAX_MESSAGE}`);
    count.id = 'guestbook-character-count';
    const messageFooter = element('div', 'guestbook-message-footer');
    messageFooter.append(count);
    const publicNote = element('p', 'guestbook-public-note', 'Your note and chosen name will be public.');
    publicNote.id = 'guestbook-public-note';
    const submit = element('button', 'guestbook-submit', 'Post note');
    submit.type = 'submit';
    const feedback = element('p', 'guestbook-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
    feedback.id = 'guestbook-feedback';
    submit.setAttribute('aria-describedby', feedback.id);
    const availability = element('p', 'guestbook-availability');
    availability.hidden = true;
    form.append(avatars, nicknameLabel, nickname, anonymousLabel, messageLabel, message,
        messageFooter, publicNote, submit, feedback, availability);
    mount.replaceChildren(header, recent, form);

    function setFeedback(text, state = '') {
        feedback.textContent = text;
        feedback.dataset.state = state;
    }

    function syncForm() {
        nickname.disabled = busy || anonymous.checked;
        anonymous.disabled = busy;
        message.disabled = busy;
        avatarInputs.forEach(input => { input.disabled = busy; });
        submit.disabled = busy || !canPost || !canRequest || !canCreateRequestId || Date.now() < retryAt;
        submit.textContent = busy ? 'Posting…' : 'Post note';
        form.setAttribute('aria-busy', String(busy));
    }

    function updateCount() {
        count.textContent = `${characterCount(message.value)} / ${MAX_MESSAGE}`;
    }

    function limitCharacters(input, maximum, onChange = () => {}) {
        let composing = false;
        function applyLimit() {
            const characters = Array.from(input.value);
            if (characters.length > maximum) {
                const start = input.selectionStart;
                const end = input.selectionEnd;
                input.value = characters.slice(0, maximum).join('');
                if (typeof start === 'number' && typeof end === 'number') {
                    input.setSelectionRange(Math.min(start, input.value.length), Math.min(end, input.value.length));
                }
            }
            onChange();
        }
        input.addEventListener('compositionstart', () => { composing = true; });
        input.addEventListener('compositionend', () => {
            composing = false;
            applyLimit();
        });
        input.addEventListener('input', event => {
            input.removeAttribute('aria-invalid');
            if (!composing && !event.isComposing) applyLimit();
            else onChange();
        });
    }

    anonymous.addEventListener('change', () => {
        if (anonymous.checked) {
            savedNickname = nickname.value;
            nickname.value = 'Anonymous';
            nickname.removeAttribute('aria-invalid');
        } else {
            nickname.value = savedNickname;
        }
        syncForm();
    });
    limitCharacters(nickname, MAX_NICKNAME);
    limitCharacters(message, MAX_MESSAGE, updateCount);

    async function request(method, payload, controller) {
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const headers = { Accept: 'application/json' };
            if (payload) headers['Content-Type'] = 'application/json';
            const response = await fetch(new URL('comments', endpoint).href, {
                method,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                cache: 'no-store',
                redirect: 'error',
                headers,
                body: payload ? JSON.stringify(payload) : undefined,
                signal: controller.signal
            });
            let data = null;
            try {
                data = await response.json();
            } catch (error) {
                if (controller.signal.aborted) throw error;
            }
            return { response, data };
        } finally {
            clearTimeout(timeout);
        }
    }

    function renderComments(comments) {
        const entries = [...comments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
        const nodes = entries.slice(0, MAX_COMMENTS).map(comment => {
            const item = element('li', 'guestbook-comment');
            const article = element('article');
            const meta = element('div', 'guestbook-comment-meta');
            const avatar = element('img', 'guestbook-comment-avatar');
            avatar.src = `images/guestbook/${comment.avatar}.svg`;
            avatar.alt = '';
            avatar.width = 30;
            avatar.height = 30;
            avatar.decoding = 'async';
            const author = element('span', 'guestbook-comment-author', comment.nickname);
            const time = element('time', 'guestbook-comment-time', shortDate.format(new Date(comment.createdAt)));
            time.dateTime = comment.createdAt;
            time.title = fullDate.format(new Date(comment.createdAt));
            time.setAttribute('aria-label', time.title);
            meta.append(avatar, author, time);
            const text = element('p', 'guestbook-comment-message', comment.message);
            article.append(meta, text);
            item.append(article);
            return item;
        });
        list.replaceChildren(...nodes);
        list.hidden = nodes.length === 0;
        listStatus.textContent = nodes.length ? 'Latest notes' : 'No notes yet. Be the first to say hello.';
        listStatus.dataset.state = nodes.length ? 'ready' : 'empty';
    }

    async function loadComments() {
        if (!canRequest) return;
        const version = ++listVersion;
        listController?.abort();
        listController = new AbortController();
        const controller = listController;
        recent.setAttribute('aria-busy', 'true');
        listStatus.textContent = 'Loading notes…';
        listStatus.dataset.state = 'loading';
        reloadButton.hidden = true;
        try {
            const { response, data } = await request('GET', null, controller);
            if (version !== listVersion) return;
            if (!response.ok || !validList(data)) throw new Error('Invalid comment list.');
            renderComments(data.comments);
        } catch (_) {
            if (version !== listVersion) return;
            listStatus.textContent = 'Notes could not be loaded. Please try again.';
            listStatus.dataset.state = 'error';
            reloadButton.hidden = false;
        } finally {
            if (version === listVersion) recent.setAttribute('aria-busy', 'false');
        }
    }

    function rateLimitDelay(value) {
        if (value && /^\d+$/.test(value.trim())) {
            const seconds = Number(value.trim());
            if (Number.isSafeInteger(seconds) && seconds >= 0) return Math.max(1000, seconds * 1000);
        }
        const date = value ? Date.parse(value) : NaN;
        return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000;
    }

    function waitForRetry(delay) {
        retryAt = Date.now() + delay;
        const minutes = Math.ceil(delay / 60000);
        const wait = delay < 60000 ? `${Math.ceil(delay / 1000)} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
        setFeedback(`Please wait ${wait} before trying again. Your note is still here.`, 'error');
        clearTimeout(retryTimer);
        function checkRetry() {
            const remaining = retryAt - Date.now();
            if (remaining > 0) {
                retryTimer = setTimeout(checkRetry, Math.min(remaining, 2147483647));
            } else {
                retryAt = 0;
                setFeedback('You can try posting your note again.');
                syncForm();
            }
        }
        retryTimer = setTimeout(checkRetry, Math.min(delay, 2147483647));
    }

    function clientError(code) {
        const messages = {
            INVALID_NICKNAME: 'Please use a nickname of 1 to 24 characters.',
            INVALID_MESSAGE: 'Please write a note of 1 to 500 characters.',
            INVALID_AVATAR: 'Please choose one of the available avatars.',
            CLIENT_ADDRESS_UNAVAILABLE: 'Your connection could not be verified. Please try again.'
        };
        return Object.hasOwn(messages, code) ? messages[code] : 'Please check your nickname and note, then try again.';
    }

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !canPost || !canRequest || !canCreateRequestId || Date.now() < retryAt) return;
        const name = anonymous.checked ? 'Anonymous' : nickname.value.trim();
        const text = message.value.trim();
        if (!name || characterCount(name) > MAX_NICKNAME) {
            setFeedback('Please enter a nickname of 1 to 24 characters, or post anonymously.', 'error');
            nickname.setAttribute('aria-invalid', 'true');
            nickname.focus();
            return;
        }
        if (!text || characterCount(text) > MAX_MESSAGE) {
            setFeedback('Please write a note of 1 to 500 characters.', 'error');
            message.setAttribute('aria-invalid', 'true');
            message.focus();
            return;
        }
        const avatar = avatarInputs.find(input => input.checked)?.value;
        if (!AVATARS.includes(avatar)) {
            setFeedback('Please choose an avatar for your note.', 'error');
            avatarInputs[0].focus();
            return;
        }
        const payload = { nickname: name, anonymous: anonymous.checked, avatar, message: text, website: '' };
        const fingerprint = JSON.stringify(payload);
        // Keep the request ID after uncertain failures so a retry cannot publish a duplicate.
        if (!pendingSubmission || pendingSubmission.fingerprint !== fingerprint) {
            pendingSubmission = { fingerprint, body: { ...payload, requestId: crypto.randomUUID() } };
        }
        busy = true;
        setFeedback('Posting your note…');
        syncForm();
        try {
            const { response, data } = await request('POST', pendingSubmission.body, new AbortController());
            if (response.status === 429) {
                waitForRetry(rateLimitDelay(response.headers.get('Retry-After')));
            } else if (response.status === 400) {
                setFeedback(clientError(data?.code), 'error');
            } else if (response.status === 403) {
                setFeedback('Posting is unavailable from this page. Please use the live website.', 'error');
            } else if (response.status !== 200 && response.status !== 201) {
                setFeedback('Your note could not be posted. Please try again.', 'error');
            } else if (!validComment(data?.comment) || data.comment.id !== pendingSubmission.body.requestId ||
                data.comment.nickname !== payload.nickname || data.comment.avatar !== payload.avatar || data.comment.message !== payload.message) {
                setFeedback('Posting could not be confirmed. Please retry to check your note safely.', 'error');
            } else {
                pendingSubmission = null;
                message.value = '';
                message.removeAttribute('aria-invalid');
                updateCount();
                setFeedback('Your note has been posted. Thank you!', 'success');
                loadComments();
            }
        } catch (error) {
            const text = error.name === 'AbortError'
                ? 'The request timed out. Your note is still here; please try again.'
                : 'Could not reach the guestbook. Your note is still here; please try again.';
            setFeedback(text, 'error');
        } finally {
            busy = false;
            syncForm();
        }
    });

    reloadButton.addEventListener('click', loadComments);
    if (!canRequest) {
        listStatus.textContent = endpoint ? 'The guestbook is unavailable in this browser.' : 'The guestbook is not connected yet.';
        listStatus.dataset.state = 'unavailable';
        list.hidden = true;
        availability.textContent = 'Posting will be available when the guestbook is connected.';
    } else if (!canPost) {
        availability.textContent = 'Posting is available on the live website.';
    } else if (!canCreateRequestId) {
        availability.textContent = 'Please use a current browser to post a note.';
    }
    availability.hidden = !availability.textContent;
    syncForm();
    loadComments();
})();
