/**
 * Tests for the states every provider list shares (Issue #85): loading, no matches, no data, error with
 * Try again, and the guard that turns a thrown error into the error state.
 *
 * node --test tests/directory-states.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const R = require('../assets/js/request-resilience.js');

// A very small stand-in for the DOM: enough for renderState to build its box and for a test to press the buttons.
function fakeDom() {
  const made = [];
  function el(tag) {
    const node = {
      tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '', disabled: false, _html: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
      get innerHTML() { return this._html; }
    };
    made.push(node);
    return node;
  }
  return { el, made, document: { createElement: el } };
}

function textOf(node) {
  return node._html + ' ' + node.textContent + ' ' + node.children.map(textOf).join(' ');
}

function withDom(fn) {
  const dom = fakeDom();
  globalThis.document = dom.document;
  try { return fn(dom); } finally { delete globalThis.document; }
}

test('describeDirectory: loading, no matches, no data and error are four different states', () => {
  const loading = R.describeDirectory('loading', { noun: 'doctors' });
  const noResults = R.describeDirectory('no-results', { noun: 'doctors' });
  const noData = R.describeDirectory('no-data', { noun: 'doctors' });
  const error = R.describeDirectory('error', { noun: 'doctors' });
  assert.deepStrictEqual([loading.state, noResults.state, noData.state, error.state], ['loading', 'empty', 'empty', 'error']);
  assert.match(loading.message, /Loading doctors/);
  assert.match(noResults.message, /No doctors found matching your criteria/);
  assert.notStrictEqual(noResults.title, noData.title);
  assert.match(noData.message, /does not mean there are none nearby/);
  assert.match(error.title, /could not be shown/);
});

test('an unknown kind is treated as an error, never as an empty list', () => {
  assert.strictEqual(R.describeDirectory('something-else', { noun: 'pharmacies' }).state, 'error');
  assert.strictEqual(R.describeDirectory(undefined).state, 'error');
});

test('no state claims that a provider is live, open or available', () => {
  ['loading', 'no-results', 'no-data', 'error'].forEach((kind) => {
    const m = R.describeDirectory(kind, { noun: 'ambulance services' });
    const text = [m.title, m.message].join(' ');
    assert.doesNotMatch(text, /\b(live|open now|available now|verified|real[- ]time|currently available|24\/7)\b/i, kind);
  });
});

test('the reset button only exists when there is something to reset', () => {
  assert.strictEqual(R.describeDirectory('no-results', { noun: 'x' }).secondary, null);
  const withReset = R.describeDirectory('no-results', { noun: 'x', onReset() {} });
  assert.strictEqual(withReset.secondary.label, 'Clear search and filters');
  assert.strictEqual(R.describeDirectory('no-data', { noun: 'x', onReset() {} }).secondary, undefined);
});

test('describeState keeps the emergency flag on empty and error states and the roles differ', () => {
  const empty = R.describeState(R.describeDirectory('no-results', { noun: 'doctors' }));
  const error = R.describeState(R.describeDirectory('error', { noun: 'doctors' }));
  assert.strictEqual(empty.role, 'status');
  assert.strictEqual(empty.retry, false);
  assert.strictEqual(empty.emergency, true);
  assert.strictEqual(error.role, 'alert');
  assert.strictEqual(error.retry, true);
  assert.strictEqual(error.emergency, true);
});

test('renderDirectory: no results has the emergency line and a clear button that works; no retry button', () => {
  withDom((dom) => {
    const container = dom.el('div');
    let cleared = 0;
    R.renderDirectory(container, 'no-results', { noun: 'pharmacies', onReset: () => { cleared += 1; } });
    const box = container.children[0];
    assert.strictEqual(box.attrs['data-state'], 'empty');
    assert.strictEqual(box.attrs.role, 'status');
    assert.match(textOf(box), /emergency number/);
    const buttons = box.children.filter((c) => c.tag === 'button');
    assert.deepStrictEqual(buttons.map((b) => b.textContent), ['Clear search and filters']);
    buttons[0].listeners.click();
    assert.strictEqual(cleared, 1);
  });
});

test('renderDirectory: no data is also an empty state, without any button', () => {
  withDom((dom) => {
    const container = dom.el('div');
    R.renderDirectory(container, 'no-data', { noun: 'doctors', onReset() {} });
    const box = container.children[0];
    assert.strictEqual(box.attrs['data-state'], 'empty');
    assert.strictEqual(box.children.filter((c) => c.tag === 'button').length, 0);
    assert.match(textOf(box), /No doctors are listed right now/);
  });
});

test('guardList: when building the list throws, the error state with a Try again button is shown', () => {
  R.clearRecentErrors();
  withDom((dom) => {
    const container = dom.el('div');
    const ran = R.guardList(container, () => { throw new TypeError('boom with private text'); }, { context: 'doctors list', noun: 'doctors' });
    assert.strictEqual(ran, false);
    const box = container.children[0];
    assert.strictEqual(box.attrs['data-state'], 'error');
    assert.strictEqual(box.attrs.role, 'alert');
    const text = textOf(box);
    assert.match(text, /could not be shown/);
    assert.match(text, /emergency number/);
    assert.doesNotMatch(text, /boom with private text/, 'the raw error text is never shown');
    assert.deepStrictEqual(box.children.filter((c) => c.tag === 'button').map((b) => b.textContent), ['Try again']);
  });
  const logged = R.recentErrors();
  assert.strictEqual(logged.length, 1);
  assert.strictEqual(logged[0].context, 'doctors list');
  assert.doesNotMatch(JSON.stringify(logged), /private text/);
});

test('guardList: Try again runs the builder again and the list comes back', async () => {
  await withDom(async (dom) => {
    const container = dom.el('div');
    let calls = 0;
    const build = () => {
      calls += 1;
      if (calls === 1) throw new Error('first time fails');
      container.innerHTML = '';
      container.appendChild({ tag: 'p', children: [], _html: 'the list', textContent: '' });
    };
    assert.strictEqual(R.guardList(container, build, { noun: 'doctors' }), false);
    const retry = container.children[0].children.find((c) => c.tag === 'button');
    retry.listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(calls, 2);
    assert.match(textOf(container), /the list/);
    assert.ok(!/could not be shown/.test(textOf(container)));
  });
});

test('guardList: a second failure shows the error state again instead of nothing', async () => {
  await withDom(async (dom) => {
    const container = dom.el('div');
    let calls = 0;
    R.guardList(container, () => { calls += 1; throw new Error('still broken'); }, { noun: 'pharmacies' });
    container.children[0].children.find((c) => c.tag === 'button').listeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(calls, 2);
    assert.strictEqual(container.children[0].attrs['data-state'], 'error');
  });
});

test('guardList returns true and shows nothing extra when the builder works', () => {
  withDom((dom) => {
    const container = dom.el('div');
    assert.strictEqual(R.guardList(container, () => {}, { noun: 'doctors' }), true);
    assert.strictEqual(container.children.length, 0);
  });
});
