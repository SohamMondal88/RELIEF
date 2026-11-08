/**
 * Regression tests for Issue #51: keyboard and screen reader support in the core flows.
 *
 * The behaviour itself (where focus goes, what is announced) is covered in a real browser by
 * e2e/accessibility.spec.js. These tests cover what can be checked without a browser:
 * the colour tokens, the markup every page must have, and the small pure helpers.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const HTML_FILES = ['index.html']
    .concat(fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f));
const CSS_FILES = fs.readdirSync(path.join(ROOT, 'assets/css')).filter((f) => f.endsWith('.css')).map((f) => 'assets/css/' + f);

// ---------- WCAG contrast ----------

function luminance(hex) {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function tokens(css) {
    const found = {};
    for (const match of css.matchAll(/^\s+(--[a-z-]+):\s*(#[0-9a-fA-F]{6});/gm)) found[match[1]] = match[2].toLowerCase();
    return found;
}

describe('contrast helper', () => {
    it('knows the extremes', () => {
        assert.strictEqual(Math.round(contrast('#000000', '#ffffff')), 21);
        assert.strictEqual(contrast('#777777', '#777777'), 1);
    });
});

describe('theme colour tokens', () => {
    // Pairs used in the pages: white text on a filled button, the colour as text on white, and as text
    // on the light tints the cards and badges use.
    const WHITE = '#ffffff';
    const TINTS = ['#f9f9f9', '#e8f5e9', '#e6f8f4', '#e3f2fd'];

    it('every stylesheet that defines the brand colours keeps white-on-colour at 4.5:1 or better', () => {
        let checked = 0;
        for (const file of CSS_FILES) {
            const t = tokens(read(file));
            for (const name of ['--primary-color', '--secondary-color', '--accent-color', '--danger-color']) {
                if (!t[name] || file === 'assets/css/onboarding.css') continue;
                // auth.css redefines --primary-color further down for its own blue; that one counts too
                const ratio = contrast(t[name], WHITE);
                assert.ok(ratio >= 4.5, `${file} ${name} ${t[name]} on white is ${ratio.toFixed(2)}`);
                checked++;
            }
        }
        assert.ok(checked > 30, 'expected to check the tokens of every page stylesheet, checked ' + checked);
    });

    it('primary and secondary colours stay readable as text on the light tints', () => {
        const t = tokens(read('assets/css/style.css'));
        for (const name of ['--primary-color', '--secondary-color']) {
            for (const tint of TINTS) {
                const ratio = contrast(t[name], tint);
                assert.ok(ratio >= 4.5, `${name} ${t[name]} on ${tint} is ${ratio.toFixed(2)}`);
            }
        }
    });

    it('muted text (--dark-light) is readable on white and on the pink alert tint', () => {
        const t = tokens(read('assets/css/style.css'));
        assert.ok(contrast(t['--dark-light'], WHITE) >= 4.5);
        assert.ok(contrast(t['--dark-light'], '#f2e2e6') >= 4.5);
    });

    it('the stylesheets agree on the values, so one page does not drift back', () => {
        const base = tokens(read('assets/css/style.css'));
        for (const file of CSS_FILES) {
            const t = tokens(read(file));
            for (const name of ['--secondary-color', '--accent-color', '--dark-light']) {
                if (t[name] && file !== 'assets/css/onboarding.css') assert.strictEqual(t[name], base[name], `${file} ${name}`);
            }
        }
    });

    it('the dashboard pill and the legal "last updated" line pass 4.5:1', () => {
        assert.ok(contrast('#0b57d0', '#eaf2ff') >= 4.5);
        for (const page of ['cookie-policy', 'privacy-policy', 'terms-of-service']) {
            const colour = read(`pages/${page}.html`).match(/\.last-updated \{[^}]*color:\s*(#[0-9a-f]{6})/i)[1];
            assert.ok(contrast(colour, '#ffffff') >= 4.5, page);
        }
        assert.match(read('assets/css/dashboard.css'), /\.pill \{[^}]*color: #0b57d0/);
    });
});

describe('focus indicators', () => {
    it('no form field rule removes the outline without putting one back', () => {
        for (const file of CSS_FILES) {
            const css = read(file);
            for (const rule of css.matchAll(/([^{}]*:focus[^{}]*)\{([^}]*)\}/g)) {
                const selector = rule[1].trim();
                const body = rule[2];
                if (!/outline:\s*none/.test(body)) continue;
                // The tabindex="-1" targets (main, step groups, results) are only focused by a script.
                const scriptOnly = /tabindex="-1"\]|\.relief-(sos|onboarding)-dialog$|\.relief-sos-dialog/.test(selector);
                assert.ok(scriptOnly, `${file}: "${selector}" removes the outline`);
            }
        }
    });

    it('summary elements keep the default focus ring', () => {
        assert.ok(!/summary\s*\{[^}]*outline:\s*none/.test(read('assets/css/symptoms.css')));
    });
});

// ---------- landmarks and skip link ----------

describe('every page has a language, a title and a main landmark', () => {
    for (const file of HTML_FILES) {
        it(file, () => {
            const html = read(file);
            assert.match(html, /<html[^>]*\slang=["']en["']/i, 'lang');
            assert.match(html, /<title>[^<]+<\/title>|<title [^>]*>[^<]+<\/title>/i, 'title');
            assert.match(html, /<main[\s>]/i, 'main landmark');
        });
    }
});

describe('skip link', () => {
    for (const file of HTML_FILES) {
        const html = read(file);
        const skip = html.match(/<a[^>]*href="#([^"]+)"[^>]*class="skip-link"|<a[^>]*class="skip-link"[^>]*href="#([^"]+)"/);
        if (!skip) continue;
        it(`${file}: its target exists and can take focus`, () => {
            const id = skip[1] || skip[2];
            const target = html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`));
            assert.ok(target, `no element with id="${id}"`);
            assert.match(target[0], /tabindex="-1"/, 'the target needs tabindex="-1" or the browser leaves focus on the link');
        });
    }

    it('main.js does not take over the click on the skip link', () => {
        const src = read('assets/js/main.js');
        const handler = src.slice(src.indexOf("document.querySelectorAll('a[href^=\"#\"]')"));
        assert.ok(handler.indexOf("classList.contains('skip-link')") > -1);
        assert.ok(handler.indexOf("classList.contains('skip-link')") < handler.indexOf('e.preventDefault();\n\n            const targetElement'),
            'the skip link check must come before the preventDefault that handles smooth scrolling');
    });
});

// ---------- names ----------

describe('accessible names', () => {
    it('a visible label is part of the accessible name (WCAG 2.5.3)', () => {
        for (const file of HTML_FILES) {
            const html = read(file);
            for (const m of html.matchAll(/<(a|button)\b([^>]*)aria-label="([^"]*)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
                const visible = m[5].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                if (!visible) continue; // icon only: the label is the name
                assert.ok(m[3].toLowerCase().includes(visible), `${file}: aria-label "${m[3]}" does not contain the visible text "${visible}"`);
            }
        }
    });

    it('no attribute text has leaked into the visible content of a tag', () => {
        for (const file of HTML_FILES) {
            assert.ok(!/<(button|a)\b[^>]*>\s*data-i18n[a-z-]*="/.test(read(file)), file);
        }
    });

    it('the emergency direct call link names the number and keeps its visible words', () => {
        const html = read('pages/ambulances.html');
        assert.match(html, /aria-label="Direct Call 112 \(India ERSS\)[^"]*"/);
    });

    it('locale files no longer carry the removed hero aria key', () => {
        for (const lang of ['en', 'bn']) {
            const json = JSON.parse(read(`assets/locales/${lang}.json`));
            assert.strictEqual(json['home.hero.symptoms.aria'], undefined, lang);
        }
    });
});

// ---------- login and signup ----------

describe('login and signup forms', () => {
    it('have a level-one heading and autocomplete on every field', () => {
        const login = read('pages/login.html');
        const signup = read('pages/signup.html');
        assert.match(login, /<h1[^>]*>Login to Your Account<\/h1>/);
        assert.match(signup, /<h1[^>]*>Create Your Account<\/h1>/);
        assert.match(login, /id="login-email"[^>]*autocomplete="email"/);
        assert.match(login, /id="login-password"[^>]*autocomplete="current-password"/);
        assert.match(signup, /id="signup-name"[^>]*autocomplete="name"/);
        assert.match(signup, /id="signup-email"[^>]*autocomplete="email"/);
        assert.match(signup, /id="signup-password"[^>]*autocomplete="new-password"/);
        assert.match(signup, /id="signup-confirm-password"[^>]*autocomplete="new-password"/);
    });

    it('their scripts announce errors with role="alert" and do not remove them on a timer', () => {
        for (const file of ['assets/js/login.js', 'assets/js/signup.js']) {
            const src = read(file);
            assert.match(src, /setAttribute\('role', type === 'danger' \? 'alert' : 'status'\)/, file);
            assert.ok(!/setTimeout\([^)]*remove/.test(src.replace(/\s+/g, ' ')), file + ' must not remove messages on a timer');
            assert.match(src, /aria-invalid/, file);
        }
    });
});

// ---------- pure helpers ----------

describe('onboarding focus trap', () => {
    const Onboarding = require('../assets/js/onboarding.js');
    const a = { name: 'a' };
    const b = { name: 'b' };
    const c = { name: 'c' };
    const card = { name: 'dialog card' };

    it('wraps forward from the last control to the first', () => {
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], c, false, card), a);
    });

    it('wraps backward from the first control to the last', () => {
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], a, true, card), c);
    });

    it('lets the browser move normally in the middle', () => {
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], b, false, card), null);
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], b, true, card), null);
    });

    it('pulls focus in when it is on the dialog card or somewhere outside', () => {
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], card, false, card), a);
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], card, true, card), c);
        assert.strictEqual(Onboarding.getTabTarget([a, b, c], { name: 'page' }, false, card), a);
    });

    it('keeps focus on the card when the dialog has nothing to tab to', () => {
        assert.strictEqual(Onboarding.getTabTarget([], card, false, card), card);
    });
});

describe('reminder wording for assistive technology', () => {
    const R = require('../assets/js/reminders.js');

    it('describeAction keeps the visible word first and adds the medicine', () => {
        assert.strictEqual(R.describeAction('pause', 'Metformin'), 'Pause: Metformin');
        assert.strictEqual(R.describeAction('resume', ' Iron '), 'Resume: Iron');
        assert.strictEqual(R.describeAction('done', 'Zinc'), 'Done: Zinc');
        assert.strictEqual(R.describeAction('edit', ''), 'Edit');
    });

    it('describeResult gives a sentence for the status line', () => {
        assert.strictEqual(R.describeResult('pause', 'Metformin'), 'Metformin paused.');
        assert.strictEqual(R.describeResult('done', 'Zinc'), 'Zinc marked done.');
        assert.strictEqual(R.describeResult('remove', 'Iron'), 'Iron removed.');
        assert.strictEqual(R.describeResult('edit', 'Iron'), '');
    });


    it('the dashboard has a polite status line and labelled list and log', () => {
        const html = read('pages/dashboard.html');
        assert.match(html, /id="reminder-status"[^>]*role="status"[^>]*aria-live="polite"/);
        assert.match(html, /id="reminder-list"[^>]*tabindex="-1"[^>]*aria-label=/);
        assert.match(html, /id="chatbot-messages"[^>]*role="log"[^>]*aria-label="Conversation with Relief Assistant"[^>]*tabindex="0"/);
    });
});
