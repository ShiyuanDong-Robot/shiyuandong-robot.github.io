'use strict';

(() => {
    const feed = document.querySelector('#moments-feed');
    const status = document.querySelector('#moments-status');
    const statusTitle = status?.querySelector('.moments-status-title');
    const statusCopy = status?.querySelector('.moments-status-copy');
    const retry = document.querySelector('#moments-retry');
    const toggle = document.querySelector('.moments-toggle');
    if (!feed || !status || !statusTitle || !statusCopy || !retry || !toggle) return;

    const dialog = document.querySelector('#moments-dialog');
    const dialogTitle = document.querySelector('#moments-dialog-title');
    const closeButton = dialog?.querySelector('.moments-dialog-close');
    const stage = dialog?.querySelector('.moments-photo-stage');
    const fullPhoto = dialog?.querySelector('.moments-photo-full');
    const photoError = dialog?.querySelector('.moments-photo-error');
    const previous = dialog?.querySelector('.moments-photo-prev');
    const next = dialog?.querySelector('.moments-photo-next');
    const photoCount = dialog?.querySelector('.moments-photo-count');
    const photoCaption = dialog?.querySelector('.moments-photo-caption');
    const canShowDialog = Boolean(dialog && typeof dialog.showModal === 'function' &&
        dialogTitle && closeButton && stage && fullPhoto && photoError && previous && next && photoCount && photoCaption);
    const dateFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    let articles = [];
    let expanded = false;
    let loadVersion = 0;
    let loadController = null;
    let activeMoment = null;
    let photoIndex = 0;
    let photoVersion = 0;
    let opener = null;
    let swipeStart = null;

    function isRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function validPhotoPath(value) {
        if (typeof value !== 'string' || !value.startsWith('images/moments/')) return false;
        if (/[\\?#%:\u0000-\u001f\u007f<>"|]/.test(value) || !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(value)) return false;
        return value.split('/').every(part => part.length > 0 && part === part.trim() && part !== '.' && part !== '..');
    }

    function validateMoments(data) {
        if (!Array.isArray(data)) throw new Error('Moments data must be an array.');
        return data.map((entry, index) => {
            const label = `Moment ${index + 1}`;
            if (!isRecord(entry) || Object.keys(entry).some(key => !['date', 'text', 'location', 'photos'].includes(key))) {
                throw new Error(`${label} has an invalid object structure.`);
            }
            if (typeof entry.date !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
                throw new Error(`${label} must have a YYYY-MM-DD date.`);
            }
            const date = new Date(`${entry.date}T00:00:00.000Z`);
            if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== entry.date) {
                throw new Error(`${label} has an invalid calendar date.`);
            }
            if (typeof entry.text !== 'string' || !Array.isArray(entry.photos) ||
                (entry.location !== undefined && typeof entry.location !== 'string')) {
                throw new Error(`${label} must have text, a photo array, and an optional text location.`);
            }
            const photos = entry.photos.map((photo, photoNumber) => {
                if (!isRecord(photo) || Object.keys(photo).some(key => !['src', 'alt'].includes(key)) ||
                    !validPhotoPath(photo.src) || typeof photo.alt !== 'string' || !photo.alt.trim()) {
                    throw new Error(`${label}, photo ${photoNumber + 1} needs a local image path and description.`);
                }
                return { src: photo.src, alt: photo.alt.trim() };
            });
            const text = entry.text.trim();
            if (!text && photos.length === 0) throw new Error(`${label} must contain text or photos.`);
            return { date: entry.date, text, location: entry.location?.trim() || '', photos };
        }).sort((a, b) => b.date.localeCompare(a.date));
    }

    function showStatus(title, copy, allowRetry = false) {
        statusTitle.textContent = title;
        statusCopy.textContent = copy;
        status.hidden = false;
        retry.hidden = !allowRetry;
    }

    function updateVisibleMoments() {
        articles.forEach((article, index) => { article.hidden = !expanded && index >= 3; });
        toggle.hidden = articles.length <= 3;
        toggle.setAttribute('aria-expanded', String(expanded));
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = expanded ? '↑' : '↓';
        toggle.replaceChildren(document.createTextNode(expanded ? 'Show less ' : 'Show all moments '), arrow);
    }

    function renderMoments(moments) {
        articles.forEach(article => article.remove());
        articles = [];
        expanded = false;
        const fragment = document.createDocumentFragment();
        moments.forEach(moment => {
            const article = document.createElement('article');
            article.className = 'moment-item';
            const time = document.createElement('time');
            time.className = 'moment-date';
            time.dateTime = moment.date;
            time.textContent = dateFormat.format(new Date(`${moment.date}T00:00:00Z`));
            const body = document.createElement('div');
            body.className = 'moment-body';
            if (moment.text) {
                const text = document.createElement('p');
                text.className = 'moment-text';
                text.textContent = moment.text;
                body.append(text);
            }
            if (moment.location) {
                const location = document.createElement('p');
                location.className = 'moment-location';
                location.textContent = moment.location;
                body.append(location);
            }
            if (moment.photos.length) {
                const grid = document.createElement('div');
                grid.className = 'moment-photos';
                grid.dataset.count = String(moment.photos.length);
                moment.photos.slice(0, 9).forEach((photo, index) => {
                    const link = document.createElement('a');
                    link.className = 'moment-photo';
                    link.href = photo.src;
                    link.setAttribute('aria-label', `Open photo ${index + 1} of ${moment.photos.length}: ${photo.alt}`);
                    const image = document.createElement('img');
                    image.alt = photo.alt;
                    image.loading = 'lazy';
                    image.decoding = 'async';
                    image.addEventListener('error', () => {
                        image.hidden = true;
                        link.classList.add('is-unavailable');
                        const unavailable = document.createElement('span');
                        unavailable.className = 'moment-photo-unavailable';
                        unavailable.textContent = 'Photo unavailable';
                        link.append(unavailable);
                    }, { once: true });
                    image.src = photo.src;
                    link.append(image);
                    if (index === 8 && moment.photos.length > 9) {
                        const more = document.createElement('span');
                        more.className = 'moment-photo-more';
                        more.textContent = `+${moment.photos.length - 9}`;
                        more.setAttribute('aria-hidden', 'true');
                        link.append(more);
                        link.setAttribute('aria-label', `${link.getAttribute('aria-label')}; ${moment.photos.length - 9} more photos`);
                    }
                    if (canShowDialog) {
                        link.addEventListener('click', event => {
                            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
                            if (openGallery(moment, index, link)) event.preventDefault();
                        });
                    }
                    grid.append(link);
                });
                body.append(grid);
            }
            article.append(time, body);
            fragment.append(article);
            articles.push(article);
        });
        feed.append(fragment);
        updateVisibleMoments();
    }

    async function loadMoments() {
        const version = ++loadVersion;
        loadController?.abort();
        loadController = typeof AbortController === 'function' ? new AbortController() : null;
        retry.disabled = true;
        toggle.hidden = true;
        showStatus('Loading moments', 'Loading photos and notes…');
        feed.setAttribute('aria-busy', 'true');
        try {
            const response = await fetch('data/moments.json', { cache: 'no-cache', ...(loadController ? { signal: loadController.signal } : {}) });
            if (!response.ok) throw new Error(`Moments request failed with HTTP ${response.status}.`);
            const moments = validateMoments(await response.json());
            if (version !== loadVersion) return;
            renderMoments(moments);
            if (moments.length) status.hidden = true;
            else showStatus('Moments to come', 'Photos and notes will appear here.');
        } catch (error) {
            if (version !== loadVersion || error.name === 'AbortError') return;
            renderMoments([]);
            showStatus('Moments could not be loaded', 'Please try again to load the photos and notes.', true);
            console.warn('Could not load moments:', error);
        } finally {
            if (version === loadVersion) {
                retry.disabled = false;
                feed.setAttribute('aria-busy', 'false');
            }
        }
    }

    function showPhoto(index) {
        if (!activeMoment || index < 0 || index >= activeMoment.photos.length) return;
        photoIndex = index;
        const version = ++photoVersion;
        const photo = activeMoment.photos[index];
        fullPhoto.hidden = true;
        photoError.hidden = true;
        stage.setAttribute('aria-busy', 'true');
        fullPhoto.alt = photo.alt;
        photoCaption.textContent = photo.alt;
        photoCount.textContent = `${index + 1} / ${activeMoment.photos.length}`;
        if ((document.activeElement === previous && index === 0) ||
            (document.activeElement === next && index === activeMoment.photos.length - 1)) {
            closeButton.focus({ preventScroll: true });
        }
        previous.hidden = next.hidden = activeMoment.photos.length === 1;
        previous.disabled = index === 0;
        next.disabled = index === activeMoment.photos.length - 1;
        const loader = new Image();
        loader.onload = () => {
            if (version !== photoVersion || !activeMoment) return;
            fullPhoto.src = photo.src;
            fullPhoto.hidden = false;
            stage.setAttribute('aria-busy', 'false');
        };
        loader.onerror = () => {
            if (version !== photoVersion || !activeMoment) return;
            photoError.textContent = activeMoment.photos.length > 1 ? 'This photo could not be loaded. Use the arrows to view another photo.' : 'This photo could not be loaded. Please try opening it again.';
            photoError.hidden = false;
            stage.setAttribute('aria-busy', 'false');
        };
        loader.src = photo.src;
    }

    function openGallery(moment, index, link) {
        activeMoment = moment;
        opener = link;
        dialogTitle.textContent = `Photos · ${dateFormat.format(new Date(`${moment.date}T00:00:00Z`))}`;
        try {
            if (!dialog.open) dialog.showModal();
        } catch (_) {
            activeMoment = null;
            opener = null;
            return false;
        }
        document.body.classList.add('moments-dialog-open');
        showPhoto(index);
        closeButton.focus({ preventScroll: true });
        return true;
    }

    if (canShowDialog) {
        fullPhoto.draggable = false;
        closeButton.addEventListener('click', () => dialog.close());
        previous.addEventListener('click', () => showPhoto(photoIndex - 1));
        next.addEventListener('click', () => showPhoto(photoIndex + 1));
        dialog.addEventListener('keydown', event => {
            if (!dialog.open || !['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') dialog.close();
            else showPhoto(photoIndex + (event.key === 'ArrowRight' ? 1 : -1));
        });
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            dialog.close();
        });
        dialog.addEventListener('click', event => {
            if (event.target !== dialog) return;
            const bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
        });
        dialog.addEventListener('close', () => {
            photoVersion += 1;
            activeMoment = null;
            swipeStart = null;
            document.body.classList.remove('moments-dialog-open');
            fullPhoto.hidden = true;
            fullPhoto.removeAttribute('src');
            stage.setAttribute('aria-busy', 'false');
            const focusTarget = opener?.isConnected && opener.getClientRects().length ? opener : !toggle.hidden ? toggle : null;
            opener = null;
            focusTarget?.focus({ preventScroll: true });
        });
        stage.addEventListener('pointerdown', event => {
            swipeStart = event.pointerType === 'touch' && event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
        });
        stage.addEventListener('pointercancel', () => { swipeStart = null; });
        stage.addEventListener('pointerup', event => {
            if (!swipeStart || event.pointerId !== swipeStart.id) return;
            const dx = event.clientX - swipeStart.x;
            const dy = event.clientY - swipeStart.y;
            swipeStart = null;
            if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showPhoto(photoIndex + (dx < 0 ? 1 : -1));
        });
    }

    retry.addEventListener('click', loadMoments);
    toggle.addEventListener('click', () => {
        expanded = !expanded;
        updateVisibleMoments();
    });
    loadMoments();
})();
