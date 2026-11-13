// Journey: the searchable emergency resource directory (Issue #105). See docs/EMERGENCY_DIRECTORY.md.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const PAGE = '/pages/emergency-directory.html';
const AXE_SOURCE = require.resolve('axe-core/axe.min.js');
const SOS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'emergency-sos.js'), 'utf8');

// Serve emergency-sos.js with a few extra lines appended, to try the page with other data.
async function withData(page, patch) {
  await page.route('**/assets/js/emergency-sos.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: SOS_SOURCE + '\n' + patch }));
}

test.describe('emergency resource directory', () => {
  test('lists every helpline with its source and a last-checked label, plus the emergency pages of RELIEF', async ({ page }) => {
    await page.goto(PAGE);
    const cards = page.locator('.dir-card');
    await expect(cards).toHaveCount(11);
    await expect(page.locator('#directory-status')).toHaveText('Showing all 11 resources.');
    const helplines = page.locator('.dir-card', { has: page.locator('.dir-call') });
    await expect(helplines).toHaveCount(7);
    for (let i = 0; i < 7; i++) {
      await expect(helplines.nth(i).locator('.dir-source')).toContainText('Source:');
      await expect(helplines.nth(i).locator('.dir-checked')).toHaveText('Last checked: not recorded');
    }
    await expect(page.getByRole('link', { name: 'Open First aid guides' })).toHaveAttribute('href', 'firstaid.html');
  });

  test('searching narrows the list and says how many matched', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByLabel('Search the directory').fill('ambulance');
    await expect(page.locator('#directory-status')).toContainText('resources match "ambulance"');
    await expect(page.getByRole('link', { name: /^Call 108/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Call 911/ })).toHaveCount(0);

    await page.getByLabel('Search the directory').fill('108');
    await expect(page.locator('.dir-card')).toHaveCount(1);
    await expect(page.locator('#directory-status')).toHaveText('1 resource matches "108".');
  });

  test('search by region finds that region', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByLabel('Search the directory').fill('united kingdom');
    await expect(page.getByRole('link', { name: /^Call 999/ })).toBeVisible();
    await expect(page.locator('.dir-card')).toHaveCount(2);
  });

  test('no match shows an empty state that points to the phone keypad, and Clear brings the list back', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByLabel('Search the directory').fill('qqqqzzzz');
    await expect(page.locator('#directory-empty')).toBeVisible();
    await expect(page.locator('#directory-empty')).toContainText('Nothing found for "qqqqzzzz"');
    await expect(page.locator('#directory-empty')).toContainText("phone's keypad");
    await expect(page.locator('#directory-status')).toHaveText('No resource matches "qqqqzzzz".');
    await expect(page.locator('.dir-card')).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('#directory-empty')).toBeHidden();
    await expect(page.locator('.dir-card')).toHaveCount(11);
    await expect(page.getByLabel('Search the directory')).toBeFocused();
  });

  test('typing markup is shown as text, never run', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByLabel('Search the directory').fill('<img src=x onerror=window.__hit=1>');
    await expect(page.locator('#directory-empty')).toBeVisible();
    expect(await page.evaluate(() => window.__hit)).toBeUndefined();
    await expect(page.locator('#directory-empty-query')).toHaveText('<img src=x onerror=window.__hit=1>');
  });

  test('works with no sign-in and no location request, and only a tap dials', async ({ page }) => {
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
    await page.getByLabel('Search the directory').fill('ambulance');
    expect(await page.evaluate(() => window.__asked)).toBe(false);
    expect((await relief(page)).links).toEqual([]);
    await page.getByRole('link', { name: /^Call 108/ }).click();
    expect((await relief(page)).links).toEqual(['tel:108']);
  });

  test('when the numbers cannot load it says so and still lists the pages of RELIEF', async ({ page }) => {
    await page.route('**/assets/js/emergency-sos.js', (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.goto(PAGE);
    await expect(page.locator('#directory-unavailable')).toBeVisible();
    await expect(page.locator('#directory-unavailable')).toContainText("phone's keypad");
    await expect(page.locator('.dir-card')).toHaveCount(4);
    await expect(page.locator('.dir-call')).toHaveCount(0);
  });

  test('an entry with no source is never listed', async ({ page }) => {
    await withData(page, "EmergencySOS.REGIONAL_EMERGENCY_DATA.IN.services[1].source = '';");
    await page.goto(PAGE);
    await expect(page.locator('.dir-call')).toHaveCount(6);
    await expect(page.getByRole('link', { name: /^Call 108/ })).toHaveCount(0);
  });

  test('a recorded check date is shown and an old one is flagged', async ({ page }) => {
    const recent = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await withData(page,
      "var IN = EmergencySOS.REGIONAL_EMERGENCY_DATA.IN.services; IN[0].lastVerified = '" + recent + "'; IN[1].lastVerified = '2020-01-01';");
    await page.goto(PAGE);
    const checked = page.locator('.dir-checked');
    await expect(checked.nth(0)).toHaveText('Last checked ' + recent);
    await expect(checked.nth(1)).toHaveText(/Last checked 2020-01-01, over 180 days ago, needs re-checking/);
    await expect(checked.nth(1)).toHaveAttribute('data-state', 'old');
  });

  test('usable at 375px: no sideways scroll, big targets', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGE);
    await expect(page.locator('.dir-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const heights = await page.locator('.dir-call, .dir-open').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    expect(heights.length).toBe(11);
    heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(44));
  });

  // The page's Content Security Policy refuses the injected axe script, so this one test runs without it.
  test.describe('axe', () => {
    test.use({ bypassCSP: true });

    test('has no automated accessibility violations (axe, WCAG 2.1 A and AA), also in the empty state', async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.locator('.dir-card').first()).toBeVisible();
      await page.addScriptTag({ path: AXE_SOURCE });
      const run = () => page.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | '));
      });
      expect(await run()).toEqual([]);
      await page.getByLabel('Search the directory').fill('qqqqzzzz');
      await expect(page.locator('#directory-empty')).toBeVisible();
      expect(await run()).toEqual([]);
    });
  });

  test('opens cleanly: no console error and no broken file of our own', async ({ page, problems }) => {
    await page.route('**/_vercel/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.goto(PAGE);
    await expect(page.locator('.dir-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems.firstParty).toEqual([]);
    expect(problems.consoleErrors.filter((c) => !/^Failed to load resource/.test(c.text))).toEqual([]);
  });
});
