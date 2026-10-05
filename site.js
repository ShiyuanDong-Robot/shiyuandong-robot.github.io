'use strict';

document.documentElement.classList.add('js');

const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
const navItems = Array.from(navLinks.querySelectorAll('a'));

function closeMenu() {
    menuToggle.setAttribute('aria-expanded', 'false');
    navLinks.classList.remove('is-open');
}

menuToggle.hidden = false;
menuToggle.addEventListener('click', () => {
    const expanded = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(expanded));
    navLinks.classList.toggle('is-open', expanded);
});
navItems.forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        menuToggle.focus();
    }
});
window.matchMedia('(min-width: 861px)').addEventListener('change', closeMenu);

// The link opens the original QR image when dialog support or JavaScript is unavailable.
const wechatLink = document.querySelector('.wechat-link');
const wechatDialog = document.querySelector('#wechat-dialog');
if (wechatLink && wechatDialog && typeof wechatDialog.showModal === 'function') {
    wechatLink.setAttribute('aria-haspopup', 'dialog');
    wechatLink.setAttribute('aria-controls', 'wechat-dialog');
    wechatLink.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        wechatDialog.showModal();
        document.body.classList.add('dialog-open');
    });
    wechatDialog.querySelector('.dialog-close').addEventListener('click', () => wechatDialog.close());
    wechatDialog.addEventListener('click', event => {
        const bounds = wechatDialog.getBoundingClientRect();
        if (event.target === wechatDialog &&
            (event.clientX < bounds.left || event.clientX > bounds.right ||
             event.clientY < bounds.top || event.clientY > bounds.bottom)) {
            wechatDialog.close();
        }
    });
    wechatDialog.addEventListener('close', () => {
        document.body.classList.remove('dialog-open');
        wechatLink.focus({ preventScroll: true });
    });
}

// All news stays visible when JavaScript is unavailable.
const olderNews = Array.from(document.querySelectorAll('.older-news'));
const newsToggle = document.querySelector('.news-toggle');
olderNews.forEach(item => { item.hidden = true; });
newsToggle.hidden = olderNews.length === 0;
newsToggle.addEventListener('click', () => {
    const expanded = newsToggle.getAttribute('aria-expanded') !== 'true';
    olderNews.forEach(item => { item.hidden = !expanded; });
    newsToggle.setAttribute('aria-expanded', String(expanded));
    newsToggle.innerHTML = expanded ? 'Show less <span aria-hidden="true">↑</span>' : 'Show all news <span aria-hidden="true">↓</span>';
});

// All publications remain visible when JavaScript is unavailable.
const publications = Array.from(document.querySelectorAll('.pub-item'));
const publicationGroups = Array.from(document.querySelectorAll('.publication-group'));
const filters = Array.from(document.querySelectorAll('[data-filter]'));
const publicationCount = document.querySelector('.publication-count');
document.querySelector('.publication-tools').hidden = false;

filters.forEach(button => button.addEventListener('click', () => {
    const year = button.dataset.filter;
    publicationGroups.forEach(group => { group.hidden = year !== 'all' && group.dataset.publicationYear !== year; });
    const count = publications.filter(publication => year === 'all' || publication.dataset.year === year).length;
    filters.forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
    publicationCount.textContent = `${count} publication${count === 1 ? '' : 's'}${year === 'all' ? '' : ` · ${year}`}`;
}));

if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                navItems.forEach(link => {
                    if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
                    else link.removeAttribute('aria-current');
                });
            }
        });
    }, { rootMargin: '-15% 0px -60% 0px', threshold: 0 });
    document.querySelectorAll('main > section').forEach(section => observer.observe(section));
}
