/**
 * Tests for Issue #107: keep health and personal details out of URLs and logs.
 * These scan the real pages and scripts, so a later change that puts a field in
 * the address bar or logs a raw error object fails here.
 * Run with: node --test tests/url-log-hygiene.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listFiles(dir, ext) {
    const out = [];
    for (const name of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, name.name);
        if (name.isDirectory()) out.push(...listFiles(rel, ext));
        else if (name.name.endsWith(ext)) out.push(rel);
    }
    return out;
}

const scripts = [...listFiles('assets/js', '.js'), ...listFiles('profiles', '.js'), 'sw.js'];
const pages = ['index.html', ...listFiles('pages', '.html')];

// Drops comments so a sentence in a comment is not mistaken for code.
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

// Returns the text between the parentheses of every console.x( ... ) call.
function consoleCalls(src) {
    const calls = [];
    const re = /console\.(log|info|debug|warn|error|trace)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        let depth = 1;
        let i = re.lastIndex;
        let quote = null;
        for (; i < src.length && depth > 0; i++) {
            const c = src[i];
            if (quote) {
                if (c === '\\') i++;
                else if (c === quote) quote = null;
            } else if (c === '"' || c === "'" || c === '`') quote = c;
            else if (c === '(') depth++;
            else if (c === ')') depth--;
        }
        calls.push({ method: m[1], args: src.slice(re.lastIndex, i - 1), index: m.index });
    }
    return calls;
}

describe('forms never put field values in the address bar', () => {
    // A form without method="post" submits with GET when JavaScript is off or has
    // crashed, and every named field lands in the query string, the browser history,
    // the referrer and the host logs. Forms that carry no named control are harmless.
    for (const page of pages) {
        const html = read(page);
        const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) || [];
        forms.forEach((form, n) => {
            const open = form.match(/<form\b[^>]*>/i)[0];
            const label = open.match(/\bid="([^"]+)"/) ? open.match(/\bid="([^"]+)"/)[1] : 'form #' + (n + 1);
            const isPost = /\bmethod\s*=\s*["']?post["']?/i.test(open);
            const named = (form.match(/<(input|select|textarea)\b[^>]*\bname\s*=/gi) || []).length;

            it(`${page} (${label}) is POST or has no named fields`, () => {
                assert.ok(isPost || named === 0,
                    `${page} ${label}: ${named} named field(s) would be sent in the URL by a GET submit. Add method="post".`);
            });
        });
    }

    it('the symptom checker, appointment, reminder, contact, login and signup forms are all POST', () => {
        const required = {
            'pages/symptoms.html': 'symptoms-form',
            'pages/appointments.html': 'patient-form',
            'pages/dashboard.html': 'reminder-form',
            'pages/contact.html': 'contactForm',
            'pages/login.html': 'login-form',
            'pages/signup.html': 'signup-form',
            'pages/hospitals.html': 'correction-form'
        };
        for (const [page, id] of Object.entries(required)) {
            const open = read(page).match(new RegExp('<form\\b[^>]*\\bid="' + id + '"[^>]*>', 'i'));
            assert.ok(open, `${page} has no form#${id}`);
            assert.match(open[0], /\bmethod="post"/i, `${page} form#${id} must be method="post"`);
        }
    });
});

describe('no script reads or builds personal data in a URL', () => {
    it('no script reads location.search, location.hash or URLSearchParams', () => {
        const hits = [];
        for (const file of scripts) {
            const src = stripComments(read(file));
            if (/location\.(search|hash)\b|URLSearchParams|document\.referrer/.test(src)) hits.push(file);
        }
        assert.deepStrictEqual(hits, [], 'These scripts read the URL or referrer. If that is on purpose, document it in docs/PRIVACY_AND_DATA.md and allow it here: ' + hits.join(', '));
    });

    it('no script pushes data into history or the address bar', () => {
        const hits = scripts.filter((f) => /history\.(pushState|replaceState)/.test(stripComments(read(f))));
        assert.deepStrictEqual(hits, []);
    });

    it('page navigation only uses fixed strings, never user input', () => {
        const bad = [];
        for (const file of scripts) {
            const src = stripComments(read(file));
            const re = /(?:location\.href|location\.assign|location\.replace)\s*(?:=|\()\s*([^;\n]+)/g;
            let m;
            while ((m = re.exec(src))) {
                const target = m[1].trim();
                // targetTel is the data-tel attribute of an emergency call button (symptoms.js).
                const fixed = /^['"][^'"$]*['"]\s*\)?$/.test(target)
                    || /^window\.location\.pathname\.includes\('\/pages\/'\)\s*\?\s*'[^']*'\s*:\s*'[^']*'\)?$/.test(target)
                    || target === 'targetTel';
                if (!fixed) bad.push(file + ': ' + target);
            }
        }
        assert.deepStrictEqual(bad, []);
    });
});

describe('console output carries no personal data', () => {
    // Raw error objects can hold field values or storage text (for example the
    // "Unexpected token 'a', "asha@examp"... is not valid JSON" message from a corrupt
    // saved session). Only the error name or code is logged.
    const SENSITIVE = /\b(value|email|phone|password|token|search|query|reminder|medicine|note|lat|lng|latitude|longitude|coords|address|session|user)\b/i;

    it('every console call logs fixed text, an error name or code, or a count', () => {
        const bad = [];
        for (const file of scripts) {
            const src = stripComments(read(file));
            for (const call of consoleCalls(src)) {
                const args = call.args.trim();
                // Plain string literals only (no template placeholders) are always safe.
                if (/^(['"])(?:(?!\1)[^\\]|\\.)*\1$/.test(args)) continue;
                // 'text', error && error.name / error.code
                const withName = /^(['"])(?:(?!\1)[^\\]|\\.)*\1\s*,\s*\w+\s*&&\s*\w+\.(name|code)$/.test(args);
                if (withName) continue;
                bad.push(`${file}: console.${call.method}(${args.slice(0, 90)})`);
            }
        }
        // The one non-trivial call is the facility data warning, which logs public facility ids.
        const allowed = bad.filter((b) => !/^assets\/js\/hospitals\.js: console\.warn\('Skipped '/.test(b));
        assert.deepStrictEqual(allowed, [], 'Log fixed text plus error.name or error.code only:\n' + allowed.join('\n'));
    });

    it('the facility warning logs ids and rule names, nothing a user typed', () => {
        const src = stripComments(read('assets/js/hospitals.js'));
        const call = consoleCalls(src).find((c) => c.method === 'warn');
        assert.ok(call, 'expected the facility data warning');
        assert.doesNotMatch(call.args.replace(/'[^']*'/g, "''"), SENSITIVE);
    });

    it('the blog no longer logs search words or filter choices', () => {
        assert.deepStrictEqual(consoleCalls(stripComments(read('assets/js/blog.js'))), []);
    });

    it('a raw error object is never logged', () => {
        const hits = [];
        for (const file of scripts) {
            for (const call of consoleCalls(stripComments(read(file)))) {
                if (/,\s*(error|err|e|ex)\s*$/.test(call.args.trim())) hits.push(file + ': ' + call.args.slice(0, 80));
            }
        }
        assert.deepStrictEqual(hits, []);
    });
});

describe('the privacy document matches the pages', () => {
    const doc = read('docs/PRIVACY_AND_DATA.md');

    it('mentions Vercel Web Analytics while any page loads it', () => {
        const loads = pages.filter((p) => read(p).includes('vercel-analytics.js'));
        assert.ok(loads.length > 0, 'expected pages that load the analytics script');
        assert.match(doc, /Vercel Web Analytics/);
    });

    it('does not claim there is no analytics', () => {
        assert.doesNotMatch(doc, /runs \*\*no analytics\*\*/);
        assert.doesNotMatch(doc, /^No analytics, /m);
    });

    it('has the leak audit checklist', () => {
        assert.match(doc, /Audit checklist: URLs, referrers and logs/);
    });
});
