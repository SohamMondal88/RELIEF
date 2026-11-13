// Journey: the emergency contact directory (Issue #49). See docs/EMERGENCY_CONTACTS.md.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const PAGE = '/pages/emergency-contacts.html';
const AXE_SOURCE = require.resolve('axe-core/axe.min.js');
const SOS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'emergency-sos.js'), 'utf8');

// Serve emergency-sos.js with a few extra lines appended, to try the page with other data.
async function withData(page, patch) {
  await page.route('**/assets/js/emergency-sos.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: SOS_SOURCE + '\n' + patch }));
}

test.describe('emergency contact directory', () => {
  test('opens on a region guessed from the browser language, with source and status on every number', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#region-select')).toHaveValue('IN');
    const cards = page.locator('.contact-card');
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('link', { name: /^Call 112, National Emergency Helpline/ })).toHaveAttribute('href', 'tel:112');
    await expect(page.getByRole('link', { name: /^Call 108/ })).toHaveAttribute('href', 'tel:108');
    for (let i = 0; i < 3; i++) {
      await expect(cards.nth(i).locator('.contact-source')).toContainText('Source:');
      await expect(cards.nth(i).locator('.contact-status')).toHaveText('Not verified yet, needs review');
    }
    await expect(page.getByRole('heading', { name: 'National numbers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Local contacts' })).toBeVisible();
    await expect(page.locator('.contact-empty')).toContainText('No local contacts are published for India yet');
  });

  test('works without signing in or sharing a location', async ({ page }) => {
    // Replaces the denied-by-default stub from fixtures.js with one that records any use.
    await page.addInitScript(() => {
      window.__asked = false;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: () => { window.__asked = true; },
          watchPosition: () => { window.__asked = true; return 0; },
          clearWatch: () => {}
        }
      });
    });
    await page.goto(PAGE);
    await expect(page.locator('.contact-card').first()).toBeVisible();
    expect(await page.evaluate(() => window.__asked)).toBe(false);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => /session|auth/.test(k)))).toEqual([]);
  });

  test('tapping a number is the only thing that dials: nothing is called on load or on choosing a region', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#region-select').selectOption('US');
    await page.locator('#region-select').selectOption('IN');
    expect((await relief(page)).links).toEqual([]);
    await page.getByRole('link', { name: /^Call 112/ }).click();
    expect((await relief(page)).links).toEqual(['tel:112']);
  });

  test('choosing another region shows that region and its own sources', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#region-select').selectOption('UK');
    await expect(page.locator('#contacts-status')).toHaveText('Showing emergency numbers for United Kingdom.');
    await expect(page.getByRole('link', { name: /^Call 999/ })).toHaveAttribute('href', 'tel:999');
    await expect(page.locator('.contact-card')).toHaveCount(2);
    await expect(page.locator('.contact-source a').first()).toHaveAttribute('href', 'https://www.gov.uk');
    await expect(page.locator('.contact-source a').first()).toHaveAttribute('rel', /noopener/);
  });

  test('an unknown browser region falls back to a manual choice and guesses nothing', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: 'ja-JP' });
    const page = await context.newPage();
    await page.route((url) => url.origin !== new URL(baseURL).origin, (route) => route.abort());
    await page.goto(baseURL + PAGE);
    await expect(page.locator('#region-select')).toHaveValue('');
    await expect(page.locator('#region-hint')).toContainText('could not tell your region');
    // every region is listed so a person can still act, but none is picked for them
    await expect(page.getByRole('heading', { name: 'India' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'United States & Canada' })).toBeVisible();
    await context.close();
  });

  test('"My region is not listed" shows every region and tells the person to check their own number', async ({ page }) => {
    await page.goto(PAGE);
    await page.locator('#region-select').selectOption('other');
    await expect(page.locator('#contacts-status')).toContainText('not in this list, so no number is picked for you');
    await expect(page.locator('.contact-group h3')).toHaveText(['India', 'European Union & GSM Universal', 'United States & Canada', 'United Kingdom']);
    await expect(page.locator('.contact-fallback')).toBeVisible();
  });

  test('unavailable data shows the manual fallback instead of an empty page', async ({ page }) => {
    await page.route('**/assets/js/emergency-sos.js', (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.goto(PAGE);
    await expect(page.locator('#contacts-unavailable')).toBeVisible();
    await expect(page.locator('#contacts-unavailable')).toContainText("Dial the emergency number for the country you are in");
    await expect(page.locator('#region-form')).toBeHidden();
    await expect(page.locator('.contact-card')).toHaveCount(0);
  });

  test('an entry with no source is left out rather than shown', async ({ page }) => {
    await withData(page, "EmergencySOS.REGIONAL_EMERGENCY_DATA.IN.services[1].source = '';");
    await page.goto(PAGE);
    await expect(page.locator('.contact-card')).toHaveCount(2);
    await expect(page.getByRole('link', { name: /^Call 108/ })).toHaveCount(0);
  });

  test('a recent check shows as verified and an old one is flagged for review', async ({ page }) => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    await withData(page,
      "var IN = EmergencySOS.REGIONAL_EMERGENCY_DATA.IN.services;" +
      "IN[0].lastVerified = '" + recent + "'; IN[1].lastVerified = '2020-01-01';");
    await page.goto(PAGE);
    const statuses = page.locator('.contact-card .contact-status');
    await expect(statuses.nth(0)).toHaveText('Verified ' + recent);
    await expect(statuses.nth(0)).toHaveAttribute('data-state', 'verified');
    await expect(statuses.nth(1)).toHaveText('Needs re-checking: last verified 2020-01-01');
    await expect(statuses.nth(1)).toHaveAttribute('data-state', 'stale');
    await expect(statuses.nth(2)).toHaveAttribute('data-state', 'unverified');
  });

  test('a local contact is listed apart from the national numbers', async ({ page }) => {
    await withData(page,
      "EmergencySOS.REGIONAL_EMERGENCY_DATA.IN.services.push({ name: 'Test local line', number: '1070', source: 'Test source', sourceUrl: null, scope: 'local', lastVerified: null });");
    await page.goto(PAGE);
    const local = page.locator('.contact-group', { has: page.getByRole('heading', { name: 'Local contacts' }) });
    await expect(local.locator('.contact-card')).toHaveCount(1);
    await expect(local.getByRole('link', { name: /^Call 1070/ })).toHaveAttribute('href', 'tel:1070');
    await expect(local.locator('.contact-source')).toContainText('no link recorded yet');
  });

  test('usable at 375px: no sideways scroll and the call buttons are big enough to tap', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGE);
    await expect(page.locator('.contact-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const boxes = await page.locator('.contact-call').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    boxes.forEach((h) => expect(h).toBeGreaterThanOrEqual(44));
  });

  // The page's Content Security Policy refuses the injected axe script, so this one test runs without it.
  test.describe('axe', () => {
    test.use({ bypassCSP: true });

    test('has no automated accessibility violations (axe, WCAG 2.1 A and AA)', async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.locator('.contact-card').first()).toBeVisible();
      await page.addScriptTag({ path: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | '));
      });
      expect(violations).toEqual([]);
    });
  });

  test('opens cleanly: no console error and no broken file of our own', async ({ page, problems }) => {
    await page.route('**/_vercel/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(PAGE);
    await expect(page.locator('.contact-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems.firstParty).toEqual([]);
    expect(problems.consoleErrors.filter((c) => !/^Failed to load resource/.test(c.text))).toEqual([]);
  });
});
