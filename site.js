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
window.matchMedia('(min-width: 721px)').addEventListener('change', closeMenu);

// All publications remain visible when JavaScript is unavailable.
const publications = Array.from(document.querySelectorAll('.pub-item'));
const filters = Array.from(document.querySelectorAll('[data-filter]'));
const publicationCount = document.querySelector('.publication-count');
document.querySelector('.publication-tools').hidden = false;

filters.forEach(button => button.addEventListener('click', () => {
    const year = button.dataset.filter;
    let count = 0;
    publications.forEach(publication => {
        publication.hidden = year !== 'all' && publication.dataset.year !== year;
        if (!publication.hidden) count += 1;
    });
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
    document.querySelectorAll('.hero, .content-section, .contact-section').forEach(section => observer.observe(section));
}
