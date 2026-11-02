'use strict';

// The directory remains fully usable without the optional pointer light.
(() => {
    const panel = document.querySelector('.venue-panel');
    if (!panel) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const reset = () => {
        cancelAnimationFrame(frame);
        frame = 0;
        panel.classList.remove('is-pointer-active');
    };
    panel.addEventListener('pointermove', event => {
        if (motion.matches || !finePointer.matches || event.pointerType === 'touch') return;
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            const bounds = panel.getBoundingClientRect();
            panel.style.setProperty('--venue-x', `${pointerX - bounds.left}px`);
            panel.style.setProperty('--venue-y', `${pointerY - bounds.top}px`);
            panel.classList.add('is-pointer-active');
        });
    });
    panel.addEventListener('pointerleave', reset);
    motion.addEventListener('change', reset);
    finePointer.addEventListener('change', reset);
})();
