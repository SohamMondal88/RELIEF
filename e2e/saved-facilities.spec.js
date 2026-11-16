// Journey: saving a facility on the hospitals page and what the page says about where the list lives (Issue #54).
// The list is kept in this browser only. These tests check that it persists, never holds a facility twice, says
// what happened when storage fails, keeps a facility that left the directory, and stays in step across tabs.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { storedJson } = require('./helpers');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8'));
const FACILITIES = DATA.facilities;
const KEY = 'relief_saved_facilities';
const cards = (page) => page.locator('.hospital-card');
const panel = (page) => page.locator('#saved-facilities');
const status = (page) => page.locator('#saved-status');

async function open(page) {
  await page.goto('/pages/hospitals.html');
  await expect(cards(page)).toHaveCount(FACILITIES.length);
}

async function seed(page, items) {
  await page.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (e) { /* blocked */ } }, [KEY, JSON.stringify(items)]);
}

test.describe('where the list lives', () => {
  test('signed out: says it stays on this device only, needs no account and is not copied to other devices', async ({ page }) => {
    await open(page);
    await expect(panel(page)).toContainText('You are not signed in. Saved facilities stay on this device only, and you do not need an account to use them.');
    await expect(panel(page)).toContainText('They are not copied to your other devices');
    await expect(panel(page)).not.toContainText('You are offline');
  });

  test('signed in: still says it is not synced to the account', async ({ page }) => {
    await open(page);
    await page.evaluate(() => window.ReliefSession.createSession({ email: 'someone@example.org', name: 'Someone' }));
    await page.reload();
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    await expect(panel(page)).toContainText('You are signed in, but saved facilities are not synced to your account. They stay on this device only.');
    await expect(panel(page)).not.toContainText('You are not signed in');
  });

  test('going offline adds a note that the saved copies may be out of date, and coming back removes it', async ({ page, context }) => {
    await open(page);
    await context.setOffline(true);
    await expect(panel(page)).toContainText('You are offline. The saved copies below still work, but they may be out of date');
    await context.setOffline(false);
    await expect(panel(page)).not.toContainText('You are offline');
  });
});

test.describe('saving and removing', () => {
  test('Save keeps one copy, says so, survives a reload, and a second press removes it', async ({ page }) => {
    await open(page);
    const first = cards(page).first();
    const name = (await first.locator('.hospital-name').innerText()).trim();
    const save = first.locator('.btn-save');
    await save.click();
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(save).toHaveText('Saved');
    await expect(status(page)).toHaveText(`Saved ${name}. It is kept on this device only.`);
    await expect(page.locator('.saved-item')).toHaveCount(1);
    const stored = await storedJson(page, KEY);
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0]).sort()).toEqual(['id', 'lat', 'lng', 'location', 'name', 'phone', 'savedAt']);

    await page.reload();
    await expect(cards(page)).toHaveCount(FACILITIES.length);
    await expect(first.locator('.btn-save')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.saved-item')).toHaveCount(1);

    await first.locator('.btn-save').click();
    await expect(status(page)).toHaveText(`Removed ${name} from your saved facilities.`);
    await expect(page.locator('.saved-item')).toHaveCount(0);
    expect(await storedJson(page, KEY)).toEqual([]);
  });

  test('removing from the saved panel updates the card and keeps the keyboard in the panel', async ({ page }) => {
    await open(page);
    await cards(page).nth(1).locator('.btn-save').click();
    const remove = page.locator('.saved-item').getByRole('button', { name: /^Remove .* from saved facilities$/ });
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.saved-item')).toHaveCount(0);
    await expect(cards(page).nth(1).locator('.btn-save')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#saved-heading')).toBeFocused();
  });

  test('the saved copy has only the facility\'s own details, never the visitor\'s location', async ({ page }) => {
    await open(page);
    await page.getByLabel('Or enter a town, village, PIN code or address').fill('Kolkata');
    await page.getByRole('button', { name: 'Set location' }).click();
    await page.locator('#sort-by').selectOption('distance');
    await expect(page.locator('.hospital-distance').first()).toBeVisible();
    await cards(page).first().locator('.btn-save').click();
    const raw = await page.evaluate((k) => localStorage.getItem(k), KEY);
    expect(raw).not.toMatch(/distance|userLocation|source|gps|manual|expiresAt/i);
    expect(await storedJson(page, 'userLocation')).toMatchObject({ source: 'manual', label: 'Kolkata' });
  });
});

test.describe('duplicates and broken entries', () => {
  // The storage migration (storage-schema.js) runs first on this page and already removes entries that are not
  // facilities, so what is left to report here is the repeat.
  test('a stored list with the same facility twice and broken entries shows each facility once and says what was left out', async ({ page }) => {
    const f = FACILITIES[0];
    const item = { id: f.id, name: f.name, location: f.district, phone: f.phone, lat: f.lat, lng: f.lng, savedAt: 1700000000000 };
    await seed(page, [item, Object.assign({}, item, { name: 'Repeat of the first' }), { id: 'no-name' }, 'junk']);
    await open(page);
    await expect(page.locator('.saved-item')).toHaveCount(1);
    await expect(page.locator('.saved-item')).toContainText(f.name);
    await expect(page.locator('.saved-item')).not.toContainText('Repeat of the first');
    await expect(panel(page)).toContainText('1 saved entry was broken or repeated and is not shown.');
    await expect(cards(page).first().locator('.btn-save')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a saved list that becomes unreadable while the page is open is shown as empty with a plain message, and saving starts a fresh one', async ({ page }) => {
    await open(page);
    await page.evaluate((key) => {
      localStorage.setItem(key, '{not json');
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, KEY);
    await expect(page.locator('.saved-item')).toHaveCount(0);
    await expect(panel(page)).toContainText('Your saved list could not be read, so it is shown empty.');
    await cards(page).first().locator('.btn-save').click();
    await expect(page.locator('.saved-item')).toHaveCount(1);
    expect(await storedJson(page, KEY)).toHaveLength(1);
  });
});

test.describe('when something goes wrong', () => {
  test('storage that refuses the write: Save says it failed, the button stays unsaved and the list is unchanged', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'relief_saved_facilities') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
        return original.call(this, key, value);
      };
    });
    const first = cards(page).first();
    const name = (await first.locator('.hospital-name').innerText()).trim();
    await first.locator('.btn-save').click();
    await expect(status(page)).toHaveText(`Could not save ${name} on this device (the browser blocked storage or it is full). Your saved list was not changed.`);
    await expect(first.locator('.btn-save')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.saved-item')).toHaveCount(0);
    expect(await storedJson(page, KEY)).toBeNull();
  });

  test('storage that cannot be read: the page still works and says saving is not available', async ({ page }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        if (key === 'relief_saved_facilities') throw new Error('SecurityError');
        return original.call(this, key);
      };
    });
    await open(page);
    await expect(panel(page)).toContainText('Saving is not available in this browser right now');
    await cards(page).first().locator('.btn-save').click();
    await expect(status(page)).toContainText('Could not save');
    await expect(cards(page).first().locator('.btn-save')).toHaveAttribute('aria-pressed', 'false');
  });

  test('a saved facility that is no longer in the directory stays, is marked, and can be removed', async ({ page }) => {
    const f = FACILITIES[0];
    await seed(page, [
      { id: f.id, name: f.name, location: f.district, phone: f.phone, lat: f.lat, lng: f.lng, savedAt: 1700000000000 },
      { id: 'closed-down-99', name: 'Closed Down Hospital', location: 'Somewhere', phone: '+91 33 1111 2222', lat: 22.5, lng: 88.3, savedAt: 1700000000000 }
    ]);
    await open(page);
    const gone = page.locator('.saved-item', { hasText: 'Closed Down Hospital' });
    await expect(gone).toContainText('No longer listed in the directory');
    await expect(gone).toContainText('call to check before you travel');
    await expect(gone.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+913311112222');
    await expect(page.locator('.saved-item', { hasText: f.name })).not.toContainText('No longer listed');

    await gone.getByRole('button', { name: /^Remove Closed Down Hospital/ }).click();
    await expect(page.locator('.saved-item')).toHaveCount(1);
    expect((await storedJson(page, KEY)).map((i) => i.id)).toEqual([f.id]);
  });

  test('when the directory cannot load, saved facilities still show and say they could not be checked', async ({ page }) => {
    await seed(page, [{ id: 'fac-001', name: 'Saved Earlier Hospital', location: 'Kolkata', phone: null, lat: 22.57, lng: 88.36, savedAt: 1700000000000 }]);
    await page.route('**/assets/data/facilities.json', (route) => route.abort());
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.state-error')).toBeVisible({ timeout: 15000 });
    const item = page.locator('.saved-item');
    await expect(item).toContainText('Saved Earlier Hospital');
    await expect(item).toContainText('The directory could not be loaded, so this saved copy could not be checked against it.');
    await expect(item).not.toContainText('No longer listed');
  });
});

test.describe('the same list everywhere', () => {
  test('a save in another tab shows up here without a reload, and so does a removal', async ({ page, context }) => {
    await open(page);
    const other = await context.newPage();
    await other.goto('/pages/hospitals.html');
    await expect(other.locator('.hospital-card')).toHaveCount(FACILITIES.length);

    await other.locator('.hospital-card').first().locator('.btn-save').click();
    await expect(cards(page).first().locator('.btn-save')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.saved-item')).toHaveCount(1);

    await other.locator('.saved-item').getByRole('button', { name: /^Remove / }).click();
    await expect(cards(page).first().locator('.btn-save')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.saved-item')).toHaveCount(0);
    await other.close();
  });

  test('filtering and sorting the list keeps the Saved state on the cards', async ({ page }) => {
    await open(page);
    const name = (await cards(page).nth(2).locator('.hospital-name').innerText()).trim();
    await cards(page).nth(2).locator('.btn-save').click();
    await page.getByLabel('Search by name, area or service').fill(name.split(' ')[0]);
    const card = cards(page).filter({ hasText: name });
    await expect(card.locator('.btn-save')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Search by name, area or service').fill('');
    await page.locator('#sort-by').selectOption('distance');
    await expect(cards(page).filter({ hasText: name }).locator('.btn-save')).toHaveAttribute('aria-pressed', 'true');
  });
  test('on a 375px phone the saved panel and cards fit with a saved facility, and the keyboard can save and remove', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    const save = cards(page).first().locator('.btn-save');
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(save).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.saved-item')).toHaveCount(1);
    // Only the saved panel and the cards are checked: the language switch in the header is 2px wide of a 375px screen on main too.
    const widest = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('#saved-facilities, #saved-facilities *, .hospital-card')).map(el => el.getBoundingClientRect().right)));
    expect(widest).toBeLessThanOrEqual(375);
    const remove = page.locator('.saved-item').getByRole('button', { name: /^Remove / });
    await remove.focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.saved-item')).toHaveCount(0);
    await expect(save).toHaveAttribute('aria-pressed', 'false');
  });
});
