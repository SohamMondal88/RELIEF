/**
 * Automated Regression Test Suite for RELIEF Issue #25:
 * Responsive Design and Accessibility Audit Across All Pages
 *
 * Verifies:
 * 1. Navigation stability, duplicate listener prevention, Escape key handling, and ARIA state synchronization
 * 2. Semantic landmarks (<main id="main-content">) and functional skip-to-content links
 * 3. Form input accessible labels, icon-only button labels, and iframe accessibility
 * 4. CSS accessibility rules (skip-link styles, focus-visible indicators, prefers-reduced-motion)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const { initMobileNavigation } = require('../assets/js/main.js');

// Core application pages audited in Issue #25
const CORE_PAGES = [
    'index.html',
    'pages/about.html',
    'pages/ambulances.html',
    'pages/appointments.html',
    'pages/blog.html',
    'pages/contact.html',
    'pages/dashboard.html',
    'pages/doctors.html',
    'pages/firstaid.html',
    'pages/hospitals.html',
    'pages/login.html',
    'pages/pharmacies.html',
    'pages/signup.html',
    'pages/subscription.html',
    'pages/symptoms.html'
];

// Helper to read file relative to repo root
function readRepoFile(relPath) {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Lightweight DOM mock for testing event handling and ARIA states in Node.js
function createMockDOM(options = {}) {
    const listeners = {};
    const hamburgerClasses = new Set();
    const navClasses = new Set();
    const dropdownClasses = new Set();
    let hamburgerAriaExpanded = 'false';
    let hamburgerAriaControls = '';
    let dropdownAriaExpanded = 'false';
    let focusCalledOnHamburger = false;

    const mockHamburger = options.hasHamburger === false ? null : {
        dataset: {},
        classList: {
            add: (c) => hamburgerClasses.add(c),
            remove: (c) => hamburgerClasses.delete(c),
            toggle: (c, force) => {
                if (force !== undefined) {
                    if (force) hamburgerClasses.add(c); else hamburgerClasses.delete(c);
                    return force;
                }
                if (hamburgerClasses.has(c)) {
                    hamburgerClasses.delete(c);
                    return false;
                }
                hamburgerClasses.add(c);
                return true;
            },
            contains: (c) => hamburgerClasses.has(c)
        },
        getAttribute: (attr) => {
            if (attr === 'aria-expanded') return hamburgerAriaExpanded;
            if (attr === 'aria-controls') return hamburgerAriaControls;
            return null;
        },
        setAttribute: (attr, val) => {
            if (attr === 'aria-expanded') hamburgerAriaExpanded = String(val);
            if (attr === 'aria-controls') hamburgerAriaControls = String(val);
        },
        focus: () => { focusCalledOnHamburger = true; },
        contains: (target) => target === mockHamburger,
        addEventListener: (event, handler) => {
            listeners[`hamburger:${event}`] = listeners[`hamburger:${event}`] || [];
            listeners[`hamburger:${event}`].push(handler);
        }
    };

    const mockNav = {
        id: options.navId || 'main-nav-links',
        classList: {
            add: (c) => navClasses.add(c),
            remove: (c) => navClasses.delete(c),
            toggle: (c, force) => {
                if (force !== undefined) {
                    if (force) navClasses.add(c); else navClasses.delete(c);
                    return force;
                }
                if (navClasses.has(c)) {
                    navClasses.delete(c);
                    return false;
                }
                navClasses.add(c);
                return true;
            },
            contains: (c) => navClasses.has(c)
        },
        contains: (target) => target === mockNav
    };

    const mockDoc = {
        querySelector: (selector) => {
            if (selector === '.hamburger') return mockHamburger;
            if (selector === '.nav-links') return mockNav;
            return null;
        },
        querySelectorAll: (selector) => {
            if (selector === '.nav-links') return [mockNav];
            if (selector === '.nav-links a') return [];
            if (selector === '.dropdown-toggle') return [];
            return [];
        },
        getElementById: (id) => {
            if (id === 'main-nav-links' && mockNav.id === 'main-nav-links') return mockNav;
            return null;
        },
        addEventListener: (event, handler) => {
            listeners[`doc:${event}`] = listeners[`doc:${event}`] || [];
            listeners[`doc:${event}`].push(handler);
        }
    };

    return {
        mockDoc,
        mockHamburger,
        mockNav,
        listeners,
        getState: () => ({
            isHamburgerActive: hamburgerClasses.has('active'),
            isNavActive: navClasses.has('active'),
            ariaExpanded: hamburgerAriaExpanded,
            ariaControls: hamburgerAriaControls,
            focusCalledOnHamburger
        }),
        triggerHamburgerClick: () => {
            const handlers = listeners['hamburger:click'] || [];
            handlers.forEach(h => h({ stopPropagation: () => {} }));
        },
        triggerKeyDown: (key) => {
            const handlers = listeners['doc:keydown'] || [];
            handlers.forEach(h => h({ key }));
        },
        triggerOutsideClick: (target) => {
            const handlers = listeners['doc:click'] || [];
            handlers.forEach(h => h({ target: target || {} }));
        }
    };
}

describe('GitHub Issue #25: Responsive Design & Accessibility Audit', () => {

    // =========================================================================
    // Stage 1: Navigation Stability and Event Handling
    // =========================================================================
    describe('Stage 1: Navigation Stability & Keyboard Interaction', () => {

        it('returns false safely without throwing errors on pages without a hamburger button', () => {
            const { mockDoc } = createMockDOM({ hasHamburger: false });
            assert.doesNotThrow(() => {
                const initialized = initMobileNavigation(mockDoc);
                assert.strictEqual(initialized, false, 'Should return false when hamburger is absent');
            });
        });

        it('returns false safely when invoked with null or undefined document', () => {
            assert.doesNotThrow(() => {
                assert.strictEqual(initMobileNavigation(null), false);
                assert.strictEqual(initMobileNavigation(undefined), false);
            });
        });

        it('prevents duplicate event listener registration using dataset.navInitialized guard', () => {
            const dom = createMockDOM();
            const firstInit = initMobileNavigation(dom.mockDoc);
            assert.strictEqual(firstInit, true, 'First initialization should succeed');
            assert.strictEqual(dom.mockHamburger.dataset.navInitialized, 'true', 'dataset.navInitialized must be set to "true"');

            const secondInit = initMobileNavigation(dom.mockDoc);
            assert.strictEqual(secondInit, false, 'Second initialization must return false without rebinding');
        });

        it('synchronizes aria-controls attribute to target navigation ID', () => {
            const dom = createMockDOM();
            initMobileNavigation(dom.mockDoc);
            const state = dom.getState();
            assert.strictEqual(state.ariaControls, 'main-nav-links', 'Hamburger aria-controls must match nav ID');
        });

        it('toggles mobile menu open/closed and updates aria-expanded and active class synchronously', () => {
            const dom = createMockDOM();
            initMobileNavigation(dom.mockDoc);

            // Initial closed state
            assert.strictEqual(dom.getState().ariaExpanded, 'false');
            assert.strictEqual(dom.getState().isHamburgerActive, false);
            assert.strictEqual(dom.getState().isNavActive, false);

            // Open menu
            dom.triggerHamburgerClick();
            assert.strictEqual(dom.getState().ariaExpanded, 'true', 'aria-expanded must become "true" when opened');
            assert.strictEqual(dom.getState().isHamburgerActive, true);
            assert.strictEqual(dom.getState().isNavActive, true);

            // Close menu
            dom.triggerHamburgerClick();
            assert.strictEqual(dom.getState().ariaExpanded, 'false', 'aria-expanded must become "false" when closed');
            assert.strictEqual(dom.getState().isHamburgerActive, false);
            assert.strictEqual(dom.getState().isNavActive, false);
        });

        it('closes the open mobile menu on Escape key press and restores focus to hamburger', () => {
            const dom = createMockDOM();
            initMobileNavigation(dom.mockDoc);

            // Open menu
            dom.triggerHamburgerClick();
            assert.strictEqual(dom.getState().isHamburgerActive, true);

            // Press Escape
            dom.triggerKeyDown('Escape');
            const state = dom.getState();
            assert.strictEqual(state.isHamburgerActive, false, 'Menu must be closed after Escape key');
            assert.strictEqual(state.ariaExpanded, 'false', 'aria-expanded must be reset to "false"');
            assert.strictEqual(state.isNavActive, false);
            assert.strictEqual(state.focusCalledOnHamburger, true, 'Focus must return to hamburger element');
        });

        it('dismisses mobile menu when user clicks outside the menu', () => {
            const dom = createMockDOM();
            initMobileNavigation(dom.mockDoc);

            // Open menu
            dom.triggerHamburgerClick();
            assert.strictEqual(dom.getState().isHamburgerActive, true);

            // Click outside
            const outsideElement = { id: 'some-outside-container' };
            dom.triggerOutsideClick(outsideElement);
            assert.strictEqual(dom.getState().isHamburgerActive, false, 'Menu must close upon outside click');
            assert.strictEqual(dom.getState().ariaExpanded, 'false');
        });

        it('guards secondary scripts across pages against duplicate hamburger bindings', () => {
            const scriptFiles = [
                'assets/js/about.js',
                'assets/js/ambulances.js',
                'assets/js/appointments.js',
                'assets/js/blog.js',
                'assets/js/contact.js',
                'assets/js/doctors.js',
                'assets/js/firstaid.js',
                'assets/js/hospitals.js',
                'assets/js/pharmacies.js',
                'assets/js/symptoms.js'
            ];

            scriptFiles.forEach(file => {
                const content = readRepoFile(file);
                const hasNavGuard = content.includes('hamburger.dataset.navInitialized') ||
                                    content.includes('!hamburger');
                assert.ok(hasNavGuard, `${file} must include null or navInitialized guard to prevent duplicate listeners`);
            });
        });
    });

    // =========================================================================
    // Stage 2 & 3: Semantic Landmarks, Skip Links, and Page-Level Accessibility
    // =========================================================================
    describe('Stage 2 & 3: Page Landmarks, Skip Links & ARIA Semantics', () => {

        CORE_PAGES.forEach(pagePath => {
            describe(`Page: ${pagePath}`, () => {
                const html = readRepoFile(pagePath);

                it('includes a functional skip-to-content link pointing to #main-content', () => {
                    const skipLinkMatch = html.match(/<a\b[^>]*href=["']#main-content["'][^>]*class=["'][^"']*skip-link[^"']*["'][^>]*>(.*?)<\/a>/i);
                    assert.ok(skipLinkMatch, `${pagePath} must contain a skip link with class="skip-link" and href="#main-content"`);
                    assert.ok(skipLinkMatch[1].trim().length > 0, `${pagePath} skip link must have descriptive link text`);
                });

                it('includes a corresponding <main id="main-content"> landmark', () => {
                    const mainMatch = html.match(/<main\b[^>]*id=["']main-content["']/i);
                    assert.ok(mainMatch, `${pagePath} must contain <main id="main-content"> landmark as target for skip link`);
                });

                it('provides accessible label and state for mobile hamburger button if present', () => {
                    const hamburgerMatch = html.match(/<button\b[^>]*class=["'][^"']*hamburger[^"']*["'][^>]*>/i);
                    if (hamburgerMatch) {
                        const tag = hamburgerMatch[0];
                        assert.ok(/aria-label=["'][^"']+["']/i.test(tag), `${pagePath} hamburger button must have aria-label`);
                        assert.ok(/aria-expanded=["'](false|true)["']/i.test(tag), `${pagePath} hamburger button must have aria-expanded`);
                        assert.ok(/aria-controls=["'][^"']+["']/i.test(tag), `${pagePath} hamburger button must have aria-controls`);
                    }
                });
            });
        });

        it('ensures search inputs on finder pages have accessible labels', () => {
            const finderPages = [
                'pages/doctors.html',
                'pages/hospitals.html',
                'pages/pharmacies.html',
                'pages/firstaid.html',
                'pages/blog.html'
            ];

            finderPages.forEach(file => {
                const html = readRepoFile(file);
                const searchInputs = html.match(/<input\b[^>]*type=["']text["'][^>]*placeholder=["'][^"']*search[^"']*["'][^>]*>/gi) ||
                                     html.match(/<input\b[^>]*placeholder=["'][^"']*search[^"']*["'][^>]*>/gi);
                assert.ok(searchInputs && searchInputs.length > 0, `${file} should contain search inputs`);
                searchInputs.forEach(inp => {
                    const hasAria = /aria-label=["'][^"']+["']/i.test(inp);
                    assert.ok(hasAria, `${file} search input must have aria-label: ${inp}`);
                });
            });
        });

        it('ensures icon-only buttons on core pages provide accessible labels', () => {
            CORE_PAGES.forEach(pagePath => {
                const html = readRepoFile(pagePath);
                // Find all buttons
                const buttonMatches = html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/gi) || [];
                buttonMatches.forEach(btn => {
                    const visibleText = btn.replace(/<[^>]+>/g, '').trim();
                    const hasAria = /aria-label=["'][^"']+["']/i.test(btn) || /aria-labelledby=["'][^"']+["']/i.test(btn);
                    if (visibleText.length === 0) {
                        assert.ok(hasAria, `Icon-only button in ${pagePath} must have aria-label or accessible text: ${btn.slice(0, 100)}`);
                    }
                });
            });
        });

        it('ensures embedded map iframe in contact.html includes a descriptive title', () => {
            const html = readRepoFile('pages/contact.html');
            const iframeMatch = html.match(/<iframe\b[^>]*>/i);
            assert.ok(iframeMatch, 'contact.html must contain iframe');
            assert.ok(/title=["'][^"']+["']/i.test(iframeMatch[0]), 'contact.html iframe must have a descriptive title attribute');
        });
    });

    // =========================================================================
    // Stage 4: CSS Accessibility & Responsive Style Tokens
    // =========================================================================
    describe('Stage 4: CSS Accessibility & Responsive Declarations', () => {
        const CSS_FILES = [
            'assets/css/style.css',
            'assets/css/professional-pages.css',
            'assets/css/auth.css',
            'assets/css/doctors.css',
            'assets/css/hospitals.css',
            'assets/css/pharmacies.css',
            'assets/css/ambulances.css',
            'assets/css/appointments.css',
            'assets/css/firstaid.css',
            'assets/css/symptoms.css',
            'assets/css/contact.css',
            'assets/css/about.css',
            'assets/css/blog.css'
        ];

        it('declares .skip-link styles that are visually hidden until focused', () => {
            CSS_FILES.forEach(cssPath => {
                const css = readRepoFile(cssPath);
                assert.ok(css.includes('.skip-link'), `${cssPath} must define .skip-link styles`);
                assert.ok(css.includes('.skip-link:focus') || css.includes('.skip-link:focus-visible'),
                    `${cssPath} must define visible transition on .skip-link:focus / :focus-visible`);
            });
        });

        it('declares visible keyboard focus rings (:focus-visible)', () => {
            CSS_FILES.forEach(cssPath => {
                const css = readRepoFile(cssPath);
                assert.ok(css.includes(':focus-visible'), `${cssPath} must declare visible focus styles via :focus-visible`);
            });
        });

        it('supports prefers-reduced-motion media query across all stylesheets', () => {
            CSS_FILES.forEach(cssPath => {
                const css = readRepoFile(cssPath);
                assert.ok(css.includes('prefers-reduced-motion'), `${cssPath} must respect prefers-reduced-motion`);
            });
        });

        it('ensures auth.css properly displays .nav-links.active on mobile screens', () => {
            const authCss = readRepoFile('assets/css/auth.css');
            const mobileMedia = authCss.match(/@media\s*\(\s*max-width:\s*768px\s*\)[\s\S]*?\.nav-links\.active\s*\{[\s\S]*?\}/);
            assert.ok(mobileMedia, 'auth.css must support displaying active nav links on mobile viewports <= 768px');
            assert.ok(mobileMedia[0].includes('display: flex') || mobileMedia[0].includes('display: block'),
                'auth.css mobile media query must show .nav-links.active');
        });
    });
});
