const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('the statement is reachable from the public home footer and its local links resolve', () => {
    const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(home.slice(home.indexOf('<footer')), /href="pages\/accessibility\.html"/);
    const statement = fs.readFileSync(path.join(root, 'pages/accessibility.html'), 'utf8');
    assert.match(statement, /<main id="main-content" tabindex="-1">/);
    assert.match(statement, /not a claim of full WCAG compliance/);
    assert.match(statement, /GitHub account is needed/);
    assert.match(statement, /Do not include patient information/);
    for (const [, href] of statement.matchAll(/href="([^"]+)"/g)) {
        if (href.startsWith('#') || href.startsWith('https:')) continue;
        assert.ok(fs.existsSync(path.resolve(root, 'pages', href)), `Broken statement link: ${href}`);
    }
});
