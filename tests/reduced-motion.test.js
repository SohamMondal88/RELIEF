const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function runAbout({ reduce, observerAvailable = true }) {
    const handlers = [];
    let frames = 0;
    const number = { textContent: '0', getAttribute: () => '250' };
    const stat = { querySelector: (selector) => selector === '.stat-number' ? number : { textContent: 'People' } };
    const context = {
        window: { matchMedia: () => ({ matches: reduce }), innerWidth: 1200 },
        document: {
            addEventListener: (event, callback) => handlers.push(callback),
            querySelector: () => null,
            querySelectorAll: (selector) => selector === '.stat-item' ? [stat] : [],
        },
        performance: { now: () => 0 },
        requestAnimationFrame: () => frames++,
    };
    if (observerAvailable) context.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; }
        observe() { this.callback([{ isIntersecting: true }]); }
        unobserve() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/about.js'), 'utf8'), context);
    handlers[0]();
    return { number, frames };
}

test('reduced motion exposes the final statistic without scheduling count-up frames', () => {
    const { number, frames } = runAbout({ reduce: true });
    assert.equal(number.textContent, '250');
    assert.equal(frames, 0);
});

test('normal motion retains the counter animation', () => {
    assert.equal(runAbout({ reduce: false }).frames, 1);
});

test('missing IntersectionObserver leaves the final statistic readable', () => {
    const { number, frames } = runAbout({ reduce: false, observerAvailable: false });
    assert.equal(number.textContent, '250');
    assert.equal(frames, 0);
});

test('motion preference is read again after a browser setting change', () => {
    let reduced = false;
    const context = { window: { matchMedia: () => ({ matches: reduced }) } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/main.js'), 'utf8'), context);
    assert.equal(context.reliefPrefersReducedMotion(), false);
    reduced = true;
    assert.equal(context.reliefPrefersReducedMotion(), true);
});
