// Journey: every map result is also in a list that works without the map (Issue #80).
// Hospitals, pharmacies and ambulances. The fixtures block the Leaflet CDN, so most tests run with no map library at
// all, which is exactly the case the list has to cover. A few add a small stand-in for Leaflet (recording what the
// pages ask of it) to check the markers and the tile failure message. The real Leaflet and real tiles are not used.
const { test, expect } = require('./fixtures');

const PAGES = [
  { key: 'hospitals', path: '/pages/hospitals.html', list: '.hospitals-list', card: '.hospital-card', name: '.hospital-name', min: 5 },
  { key: 'pharmacies', path: '/pages/pharmacies.html', list: '.pharmacies-list', card: '.pharmacy-card', name: '.pharmacy-name', min: 5 },
  // ambulances.js already had its own note for a missing map library (issue #75), so that one is kept
  { key: 'ambulances', path: '/pages/ambulances.html', list: '.ambulance-list', card: '.ambulance-item', name: '.ambulance-info h4', min: 4, noMapNote: '.map-unavailable' }
];

// A stand-in for Leaflet. It records markers and lets a test fire a tile error.
async function stubLeaflet(page) {
  await page.addInitScript(() => {
    window.__map = { markers: [], tileHandlers: {} };
    const chain = new Proxy({}, { get: (t, k) => (k === 'getBounds' ? () => ({ pad: () => ({}) }) : () => chain) });
    window.L = {
      map: () => chain,
      icon: () => ({}),
      featureGroup: function () { return chain; }, // pharmacies call it with new
      tileLayer: () => ({
        addTo() { return this; },
        on(type, fn) { window.__map.tileHandlers[type] = fn; return this; }
      }),
      marker: (latlng, options) => {
        window.__map.markers.push({ latlng, options });
        return { addTo() { return this; }, bindPopup() { return this; } };
      }
    };
  });
}

for (const p of PAGES) {
  test.describe(`${p.key}: list alternative`, () => {
    test('with no map library the page has no errors, says so, and the list has every result as a list item', async ({ page, problems }) => {
      await page.goto(p.path);
      const cards = page.locator(`${p.list} > ${p.card}`);
      await expect(cards.first()).toBeVisible();
      expect(await cards.count()).toBeGreaterThanOrEqual(p.min);

      const list = page.locator(p.list);
      await expect(list).toHaveAttribute('role', 'list');
      await expect(list).toHaveAttribute('aria-label', /.+/);
      await expect(cards.first()).toHaveAttribute('role', 'listitem');
      expect(await page.locator(`${p.list} > ${p.card}:not([role="listitem"])`).count()).toBe(0);

      const note = page.locator(p.noMapNote || '#map-note');
      await expect(note).toBeVisible();
      await expect(note).toContainText('The map could not be loaded');
      await expect(note).toContainText(/list above (still )?(has every result|works)/);
      await expect(page.locator('#map')).toBeHidden();
      await expect(page.locator('.map-skip-link')).toBeHidden();
      expect(problems.pageErrors).toEqual([]);
    });

    test('every card has a name, an address or place and named action buttons', async ({ page }) => {
      await page.goto(p.path);
      const cards = page.locator(`${p.list} > ${p.card}`);
      await expect(cards.first()).toBeVisible();
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const name = (await card.locator(p.name).first().innerText()).trim();
        expect(name.length, `card ${i} has a name`).toBeGreaterThan(0);
        const text = await card.innerText();
        expect(text, `${name} shows where it is`).toMatch(/Address:|miles away|Kolkata|Kalyani|,/i);
        const buttons = card.locator('button, a[href]');
        const n = await buttons.count();
        expect(n, `${name} has actions`).toBeGreaterThan(0);
        for (let j = 0; j < n; j++) {
          const label = ((await buttons.nth(j).getAttribute('aria-label')) || (await buttons.nth(j).innerText())).trim();
          expect(label.length, `${name}: action ${j} has a name`).toBeGreaterThan(0);
          if (/^(Call|Directions|Request Delivery)/i.test(label) && (await buttons.nth(j).getAttribute('aria-label'))) {
            expect(label, `the action says which facility it is for`).toContain(name.split(',')[0]);
          }
        }
      }
    });
  });
}

test.describe('hospitals: filters and keyboard', () => {
  test('searching narrows the list and the list stays a list; no results is not a list', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const cards = page.locator('.hospitals-list > .hospital-card');
    await expect(cards.first()).toBeVisible();
    const all = await cards.count();

    await page.locator('.search-box input').fill('kalyani');
    await expect(cards).not.toHaveCount(all);
    await expect(page.locator('.hospitals-list')).toHaveAttribute('role', 'list');
    expect(await page.locator('.hospitals-list > .hospital-card:not([role="listitem"])').count()).toBe(0);

    await page.locator('.search-box input').fill('zzzz-no-such-place');
    await expect(page.locator('.hospitals-list .no-results')).toBeVisible();
    await expect(page.locator('.hospitals-list')).not.toHaveAttribute('role', 'list');
  });

  test('Directions can be reached and used with the keyboard alone', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const first = page.locator('.hospitals-list > .hospital-card').first();
    const directions = first.locator('.btn-directions');
    await expect(directions).toBeVisible();
    await directions.focus();
    await expect(directions).toBeFocused();
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => window.__relief.opened);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d/);
  });

  test('tabbing from the first card reaches the Save button and then the next card', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const first = page.locator('.hospitals-list > .hospital-card').first();
    await first.locator('.btn-directions').focus();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim().slice(0, 60)));
    }
    expect(seen.some((label) => /^Save /.test(label))).toBe(true);
    expect(seen.some((label) => /^Suggest a correction for /.test(label))).toBe(true);
  });
});

test.describe('pharmacies: keyboard', () => {
  test('Call and Request Delivery are buttons that work with Enter and name the pharmacy', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.goto('/pages/pharmacies.html');
    const card = page.locator('.pharmacies-list > .pharmacy-card').first();
    const name = (await card.locator('.pharmacy-name').innerText()).trim();
    const call = card.getByRole('button', { name: `Call ${name}` });
    await call.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/^Calling /);
    await expect(card.getByRole('button', { name: `Request delivery from ${name}` })).toBeVisible();
  });

  test('filtering still works and keeps the list semantics', async ({ page }) => {
    await page.goto('/pages/pharmacies.html');
    const cards = page.locator('.pharmacies-list > .pharmacy-card');
    await expect(cards.first()).toBeVisible();
    await page.locator('.search-box input').fill('zzzz-no-such-pharmacy');
    await expect(page.locator('.pharmacies-list .no-results')).toBeVisible();
    await expect(page.locator('.pharmacies-list')).not.toHaveAttribute('role', 'list');
    await page.locator('.search-box input').fill('');
    await expect(page.locator('.pharmacies-list')).toHaveAttribute('role', 'list');
  });
});

test.describe('ambulances: keyboard', () => {
  test('Directions opens the route from the keyboard and Call names the service', async ({ page }) => {
    await page.goto('/pages/ambulances.html');
    const first = page.locator('.ambulance-list > .ambulance-item').first();
    const name = (await first.locator('h4').innerText()).trim();
    await expect(first.getByRole('button', { name: `Call ${name}` })).toBeVisible();
    const directions = first.getByRole('button', { name: `Directions to ${name}` });
    await directions.focus();
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => window.__relief.opened);
    expect(opened.some((u) => u.startsWith('https://www.google.com/maps/dir/?api=1&destination='))).toBe(true);
  });
});

// With a (stand-in) map library.
for (const p of PAGES) {
  test.describe(`${p.key}: with a map library`, () => {
    test.beforeEach(async ({ page }) => { await stubLeaflet(page); });

    test('the map is named, can be skipped, and every marker has the name of a listed result', async ({ page, problems }) => {
      await page.goto(p.path);
      const cards = page.locator(`${p.list} > ${p.card}`);
      await expect(cards.first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__map.markers.length)).toBeGreaterThan(0);

      const map = page.locator('#map');
      await expect(map).toHaveAttribute('role', 'region');
      await expect(map).toHaveAttribute('aria-label', /The same results are listed above with their addresses and actions/);
      await expect(page.locator('#map-note')).toContainText('Every result is also in the list above');

      // Every marker (apart from the visitor's own position) names a result in the list.
      const names = await page.locator(`${p.list} ${p.name}`).allInnerTexts();
      const markers = await page.evaluate(() => window.__map.markers.map((m) => m.options && m.options.title));
      expect(markers.length).toBeGreaterThanOrEqual(p.min - 1);
      for (const title of markers) {
        expect(title, 'every marker has a name').toBeTruthy();
        expect(names.some((n) => title.startsWith(n.trim())), `marker "${title}" is a listed result`).toBe(true);
      }
      expect(problems.pageErrors).toEqual([]);
    });

    test('the skip link is hidden until focused, then lands after the map', async ({ page }) => {
      await page.goto(p.path);
      await expect(page.locator(`${p.list} > ${p.card}`).first()).toBeVisible();
      const skip = page.getByRole('link', { name: 'Skip the map' });
      await expect(skip).toHaveCount(1);
      await skip.focus();
      await expect(skip).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page.locator('#map-end')).toBeFocused();
    });

    test('when the map pictures fail to load the note says the list has everything, and the list is unchanged', async ({ page }) => {
      await page.goto(p.path);
      const cards = page.locator(`${p.list} > ${p.card}`);
      await expect(cards.first()).toBeVisible();
      const before = await cards.count();
      await expect.poll(() => page.evaluate(() => typeof window.__map.tileHandlers.tileerror)).toBe('function');
      await page.evaluate(() => window.__map.tileHandlers.tileerror({}));
      await expect(page.locator('#map-note')).toContainText('The map pictures could not be loaded');
      await expect(page.locator('#map-note')).toContainText('list above still has every result');
      expect(await cards.count()).toBe(before);
      await expect(page.locator(p.list)).toHaveAttribute('role', 'list');
    });
  });
}
