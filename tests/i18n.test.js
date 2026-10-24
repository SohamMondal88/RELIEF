const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const i18n = require('../assets/js/i18n.js');

const root = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'assets', 'locales', f), 'utf8'));
const en = read('en.json');
const bn = read('bn.json');

describe('locale files', () => {
    it('en.json and bn.json have identical keys', () => {
        assert.deepStrictEqual(Object.keys(bn).sort(), Object.keys(en).sort());
    });

    it('every value is a string', () => {
        Object.keys(en).forEach(k => {
            assert.strictEqual(typeof en[k], 'string', k);
            assert.strictEqual(typeof bn[k], 'string', k);
        });
    });

    it('Bengali values contain Bengali script unless they are brand or number only', () => {
        Object.keys(bn).forEach(k => {
            if (bn[k] === '') return;
            assert.match(bn[k], /[\u0980-\u09FF]/, k + ' has no Bengali text');
        });
    });

    it('every data-i18n key used in the HTML exists in en.json', () => {
        const files = ['index.html']
            .concat(fs.readdirSync(path.join(root, 'pages')).filter(f => f.endsWith('.html')).map(f => 'pages/' + f));
        let found = 0;
        files.forEach(f => {
            const html = fs.readFileSync(path.join(root, f), 'utf8');
            const keys = [];
            html.replace(/data-i18n="([^"]+)"/g, (_, k) => keys.push(k));
            html.replace(/data-i18n-attr="([^"]+)"/g, (_, spec) =>
                spec.split(';').forEach(p => keys.push(p.slice(p.indexOf(':') + 1).trim())));
            keys.forEach(k => assert.ok(k in en, f + ': missing key ' + k));
            found += keys.length;
        });
        assert.ok(found > 100);
    });
});

describe('translate() fallback', () => {
    const dicts = { en: { a: 'English A', b: 'English B', e: '' }, bn: { a: 'বাংলা A', e: 'x' } };

    it('uses the selected language first', () => {
        assert.strictEqual(i18n.translate(dicts, 'bn', 'a', 'orig'), 'বাংলা A');
    });
    it('falls back from bn to en', () => {
        assert.strictEqual(i18n.translate(dicts, 'bn', 'b', 'orig'), 'English B');
    });
    it('falls back to the original HTML text when no dictionary has the key', () => {
        assert.strictEqual(i18n.translate(dicts, 'bn', 'zzz', 'orig'), 'orig');
    });
    it('returns null when nothing is available', () => {
        assert.strictEqual(i18n.translate(dicts, 'bn', 'zzz'), null);
    });
    it('still works when a dictionary failed to load', () => {
        assert.strictEqual(i18n.translate({}, 'bn', 'a', 'orig'), 'orig');
        assert.strictEqual(i18n.translate({ en: dicts.en }, 'bn', 'a', 'orig'), 'English A');
    });
    it('treats an empty string as a real translation', () => {
        assert.strictEqual(i18n.translate(dicts, 'en', 'e', 'orig'), '');
    });
    it('works with the real files', () => {
        const real = { en, bn };
        assert.strictEqual(i18n.translate(real, 'bn', 'nav.home', 'Home'), bn['nav.home']);
        assert.strictEqual(i18n.translate({ en }, 'bn', 'nav.home', 'Home'), en['nav.home']);
    });
});

describe('language choice', () => {
    it('uses a saved supported language', () => {
        assert.strictEqual(i18n.pickLanguage('bn', ['en-US']), 'bn');
    });
    it('uses a Bengali browser when nothing is saved', () => {
        assert.strictEqual(i18n.pickLanguage(null, ['bn-BD', 'en']), 'bn');
        assert.strictEqual(i18n.pickLanguage(null, ['bn-IN']), 'bn');
    });
    it('ignores a saved language that no longer exists', () => {
        assert.strictEqual(i18n.pickLanguage('hi', ['en-US']), 'en');
        assert.strictEqual(i18n.pickLanguage('hi', ['bn']), 'bn');
    });
    it('defaults to English', () => {
        assert.strictEqual(i18n.pickLanguage(null, ['fr-FR']), 'en');
        assert.strictEqual(i18n.pickLanguage(undefined, undefined), 'en');
    });
});
