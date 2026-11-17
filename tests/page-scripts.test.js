const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

test('every script in assets/js compiles', () => {
  const dir = path.join(root, 'assets', 'js');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    if (/^\s*(export|import)\s/m.test(source)) continue; // ES modules are checked by node --check in CI
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' should compile');
  }
});

test('hospitals page loads facility-utils.js before hospitals.js', () => {
  const html = fs.readFileSync(path.join(root, 'pages', 'hospitals.html'), 'utf8');
  const utils = html.indexOf('assets/js/facility-utils.js');
  const page = html.indexOf('assets/js/hospitals.js');
  assert.ok(utils !== -1, 'facility-utils.js must be included');
  assert.ok(page !== -1, 'hospitals.js must be included');
  assert.ok(utils < page, 'facility-utils.js must come first');
});

test('home, ambulances and first-aid emergency actions dial 112, not 911', () => {
  const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
  assert.match(read('index.html'), /href="tel:112" class="btn-emergency"/);
  assert.ok(!read('assets', 'js', 'ambulances.js').includes("tel:911"));
  assert.ok(!/Call 911/.test(read('pages', 'ambulances.html')));
  for (const f of ['en.json', 'bn.json']) {
    assert.ok(!/"firstaid\.banner":[^\n]*911/.test(read('assets', 'locales', f)), f);
  }
  assert.ok(!/911/.test(read('pages', 'firstaid.html')));
});
