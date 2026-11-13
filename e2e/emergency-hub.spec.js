// Journey: the emergency resource hub (Issue #46). See docs/EMERGENCY_HUB.md.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const PAGE = '/pages/emergency-hub.html';
const DATA_GLOB = '**/assets/data/emergency-hub.json';
const AXE_SOURCE = require.resolve('axe-core/axe.min.js');
const HUB = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'emergency-hub.json'), 'utf8'));

// Serve the hub file after changing it, to try the page with other content.
async function withHub(page, change) {
  const copy = JSON.parse(JSON.stringify(HUB));
  change(copy);
  await page.route(DATA_GLOB, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(copy) }));
}

test.describe('emergency resource hub', () => {
  test('groups resources by emergency type, with audience, source and review status on every card', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('.hub-card')).toHaveCount(9);
    await expect(page.locator('.hub-group h3')).toHaveText([
      'Police, fire and medical emergencies', 'Medical emergency and ambulance', 'Pregnancy and young children', 'First aid while help is on the way'
    ]);
    const cards = page.locator('.hub-card');
    for (let i = 0; i < 9; i++) {
      await expect(cards.nth(i).locator('.hub-source')).toContainText('Source:');
      await expect(cards.nth(i).locator('.hub-review')).toHaveText('Not reviewed yet');
      await expect(cards.nth(i).locator('.hub-tag').first()).toBeVisible();
    }
    await expect(page.locator('.hub-card', { hasText: 'Maternal' }).locator('.hub-tag').first()).toHaveText('Mothers and young children');
    await expect(page.locator('#hub-status')).toHaveText('Showing 9 resources, 9 not reviewed or overdue for review.');
  });

  test('says RELIEF does not dispatch help and offers a call button per region, with wellness content kept apart', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('.hub-warning')).toContainText('RELIEF does not dispatch help');
    await expect(page.locator('#hub-help-numbers a')).toHaveCount(4);
    await expect(page.locator('#hub-help-numbers').getByRole('link', { name: /^Call 999/ })).toHaveAttribute('href', 'tel:999');
    const aside = page.locator('.hub-wellness');
    await expect(aside).toContainText('Not an emergency?');
    expect(await page.locator('#hub-results .hub-wellness').count()).toBe(0);
  });

  test('searching and filtering narrow the list', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('.hub-card')).toHaveCount(9);
    await page.getByLabel('Search', { exact: true }).fill('ambulance');
    await expect(page.locator('#hub-status')).toContainText('Showing');
    await expect(page.locator('.hub-card', { hasText: 'Emergency Medical & Ambulance' })).toBeVisible();
    await page.getByLabel('Search', { exact: true }).fill('');
    await page.getByLabel('Audience').selectOption('mothers-children');
    await expect(page.locator('.hub-card')).toHaveCount(1);
    await page.getByLabel('Audience').selectOption('');
    await page.getByLabel('Emergency type').selectOption('first-aid');
    await expect(page.locator('.hub-card')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Open First aid guides' })).toHaveAttribute('href', 'firstaid.html');
  });

  test('no match shows a message and the call row stays', async ({ page }) => {
    await page.goto(PAGE);
    await page.getByLabel('Search', { exact: true }).fill('qqqqzzzz');
    await expect(page.locator('#hub-nomatch')).toBeVisible();
    await expect(page.locator('#hub-nomatch')).toContainText('Nothing matches "qqqqzzzz"');
    await expect(page.locator('#hub-status')).toHaveText('No resource matches your search and filters.');
    await expect(page.locator('.hub-card')).toHaveCount(0);
    await expect(page.locator('#hub-help-numbers a').first()).toBeVisible();
  });

  test('empty state: a hub with no resources says so', async ({ page }) => {
    await withHub(page, (h) => { h.resources = []; });
    await page.goto(PAGE);
    await expect(page.locator('#hub-empty')).toBeVisible();
    await expect(page.locator('#hub-status')).toHaveText('No resources have been published yet.');
    await expect(page.locator('.hub-card')).toHaveCount(0);
    await expect(page.locator('#hub-help-numbers a').first()).toBeVisible();
  });

  test('unavailable state: the data file failing shows the manual fallback', async ({ page }) => {
    await page.route(DATA_GLOB, (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.goto(PAGE);
    await expect(page.locator('#hub-unavailable')).toBeVisible();
    await expect(page.locator('#hub-unavailable')).toContainText("phone's keypad");
    await expect(page.locator('#hub-loading')).toBeHidden();
    await expect(page.locator('#hub-form')).toBeHidden();
    await expect(page.locator('#hub-help-numbers a').first()).toBeVisible();
  });

  test('unavailable state: a data file that is not JSON, or has the wrong shape', async ({ page }) => {
    await page.route(DATA_GLOB, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{broken' }));
    await page.goto(PAGE);
    await expect(page.locator('#hub-unavailable')).toBeVisible();

    await page.unroute(DATA_GLOB);
    await page.route(DATA_GLOB, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"resources": 5}' }));
    await page.reload();
    await expect(page.locator('#hub-unavailable')).toBeVisible();
  });

  test('unavailable state: the numbers file failing still leaves a keypad fallback', async ({ page }) => {
    await page.route('**/assets/js/emergency-sos.js', (route) => route.fulfill({ status: 503, body: 'down' }));
    await page.goto(PAGE);
    await expect(page.locator('#hub-help-numbers')).toContainText('from your phone\u2019s keypad');
    // contacts could not be resolved, so only the pages of RELIEF remain
    await expect(page.locator('.hub-card')).toHaveCount(3);
    await expect(page.locator('.hub-call')).toHaveCount(0);
  });

  test('stale state: an old review is flagged overdue, a recent one is shown as reviewed', async ({ page }) => {
    const recent = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    await withHub(page, (h) => {
      h.resources.find((r) => r.id === 'relief-sos').lastReviewed = '2020-01-01';
      h.resources.find((r) => r.id === 'relief-firstaid').lastReviewed = recent;
    });
    await page.goto(PAGE);
    const sos = page.locator('.hub-card', { hasText: 'Emergency SOS request' });
    await expect(sos.locator('.hub-review')).toHaveText('Review overdue, last reviewed 2020-01-01');
    await expect(sos.locator('.hub-review')).toHaveAttribute('data-state', 'overdue');
    const guides = page.locator('.hub-card', { hasText: 'First aid guides' });
    await expect(guides.locator('.hub-review')).toHaveText('Reviewed ' + recent);
    await expect(guides.locator('.hub-review')).toHaveAttribute('data-state', 'reviewed');
    await expect(page.locator('#hub-status')).toHaveText('Showing 9 resources, 8 not reviewed or overdue for review.');
  });

  test('a resource with a bad link is left out, not shown', async ({ page }) => {
    await withHub(page, (h) => { h.resources.find((r) => r.id === 'relief-sos').href = 'https://evil.example/'; });
    await page.goto(PAGE);
    await expect(page.locator('.hub-card')).toHaveCount(8);
    await expect(page.locator('.hub-card', { hasText: 'Emergency SOS request' })).toHaveCount(0);
  });

  test('works with no location request, and only a tap dials', async ({ page }) => {
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
    await expect(page.locator('.hub-card').first()).toBeVisible();
    expect(await page.evaluate(() => window.__asked)).toBe(false);
    expect((await relief(page)).links).toEqual([]);
    await page.locator('.hub-card .hub-call').first().click();
    expect((await relief(page)).links).toEqual(['tel:112']);
  });

  test('usable at 375px: no sideways scroll and big targets', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(PAGE);
    await expect(page.locator('.hub-card').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const heights = await page.locator('.hub-call, .hub-open').evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(8);
    heights.forEach((h) => expect(h).toBeGreaterThanOrEqual(44));
  });

  // The page's Content Security Policy refuses the injected axe script, so this one test runs without it.
  test.describe('axe', () => {
    test.use({ bypassCSP: true });

    test('has no automated accessibility violations (axe, WCAG 2.1 A and AA)', async ({ page }) => {
      await page.goto(PAGE);
      await expect(page.locator('.hub-card').first()).toBeVisible();
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
    await expect(page.locator('.hub-card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(problems.firstParty).toEqual([]);
    expect(problems.consoleErrors.filter((c) => !/^Failed to load resource/.test(c.text))).toEqual([]);
  });
});
