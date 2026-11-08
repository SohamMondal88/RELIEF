// Journey: the admin panel is a demo, and only a server can unlock the moderation controls.
// See docs/ADMIN_ACCESS.md.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const PENDING = {
  id: 'srv-1', facilityId: 'fac-001', facilityName: 'Alpha Hospital', field: 'hours',
  currentValue: 'Mon to Sat 9:00 to 17:00', proposedValue: 'Open 24 hours', status: 'pending',
  createdAt: '2026-10-26T10:00:00.000Z', history: []
};

// Serves the repo under a normal host name. localhost counts as demo mode, a made-up host name does not.
async function openAsNormalHost(page, answer) {
  await page.route('http://relief-admin.test/**', (route) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(route.request().url()).pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  // Stand-in for the backend. A getter with no setter keeps api.js (if it loads) from replacing it.
  await page.addInitScript((mode) => {
    if (!mode) return;
    const calls = { review: [] };
    window.__calls = calls;
    const fail = (code) => Object.assign(new Error(code), { code });
    const fake = {
      listFacilityCorrections: async () => {
        if (mode === 'signed-out') throw fail('unauthenticated');
        if (mode === 'user') throw fail('forbidden');
        return [mode.item];
      },
      reviewFacilityCorrection: async (id, body) => { calls.review.push({ id, body }); return { id, status: 'rejected' }; }
    };
    Object.defineProperty(window, 'ReliefAPI', { configurable: true, get: () => fake, set: () => {} });
  }, answer);
  await page.goto('http://relief-admin.test/pages/admin-panel.html');
}

// Known bug on main: api.js stops at "deleteAccount is not defined" so window.ReliefAPI is never set
// (fixed by restoring ReliefAPI.deleteAccount). These tests do not depend on api.js, they install their own stand-in.
test.use({ allowedPageErrors: [/deleteAccount is not defined/] });

function moderationQueue(page) {
  return page.locator('#correction-queue');
}

test.describe('admin panel is a demo', () => {
  test('banner is shown and the sample triage buttons are off', async ({ page }) => {
    await page.goto('/pages/admin-panel.html');
    await expect(page.locator('#admin-demo-banner')).toContainText('Demo interface, not a real admin console');
    await expect(page.locator('#admin-demo-banner')).toContainText('no sign-in or role check');
    await expect(page.getByRole('button', { name: 'Escalate SOS' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Assign Doctor' })).toBeDisabled();
    await expect(page.getByRole('heading', { name: 'Provider Verification (sample)' })).toBeVisible();
  });

  test('on a demo host the correction queue says it only lives in this browser', async ({ page }) => {
    await page.goto('/pages/admin-panel.html');
    await expect(page.locator('#moderation-demo-note')).toBeVisible();
    await expect(page.locator('#moderation-demo-note')).toContainText('stored only in this browser');
  });

  test('a forged isAdmin or role in storage and the URL changes nothing', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('isAdmin', 'true');
      localStorage.setItem('role', 'admin');
    });
    await openAsNormalHost(page, null);
    await expect(moderationQueue(page)).toContainText('cannot be sent right now');
    await expect(page.locator('#moderation-controls')).toBeHidden();
    await page.goto('http://relief-admin.test/pages/admin-panel.html?role=admin&admin=1');
    await expect(page.locator('#moderation-controls')).toBeHidden();
    await expect(page.getByRole('button', { name: /approve|reject|refresh/i })).toHaveCount(0);
  });
});

test.describe('moderation controls follow the server answer', () => {
  test('normal host with no backend: no queue and no approve or reject', async ({ page }) => {
    await openAsNormalHost(page, null);
    await expect(moderationQueue(page)).toContainText('cannot be sent right now');
    await expect(page.locator('#moderation-demo-note')).toBeHidden();
    await expect(page.locator('#moderation-controls')).toBeHidden();
    await expect(page.getByRole('button', { name: /approve|reject|refresh/i })).toHaveCount(0);
  });

  test('signed out: asks for a moderator account and shows no controls', async ({ page }) => {
    await openAsNormalHost(page, 'signed-out');
    await expect(moderationQueue(page)).toContainText('You need a moderator account');
    await expect(page.locator('#moderation-controls')).toBeHidden();
    await expect(page.getByRole('button', { name: /approve|reject|refresh/i })).toHaveCount(0);
  });

  test('signed in as a normal user (403): same, nothing listed', async ({ page }) => {
    await openAsNormalHost(page, 'user');
    await expect(moderationQueue(page)).toContainText('You need a moderator account');
    await expect(page.locator('#correction-queue .correction-item')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /approve|reject|refresh/i })).toHaveCount(0);
  });

  test('moderator: the list and the buttons appear, and a decision sends no name or role', async ({ page }) => {
    await openAsNormalHost(page, { item: PENDING });
    await expect(page.locator('#correction-queue .correction-item')).toHaveCount(1);
    await expect(page.locator('#moderation-demo-note')).toBeHidden();
    const card = page.locator('#correction-queue .correction-item');
    await card.getByLabel('Reason (needed to reject)').fill('Could not confirm by phone');
    await card.getByRole('button', { name: 'Reject' }).click();
    await expect.poll(() => page.evaluate(() => window.__calls.review.length)).toBe(1);
    const sent = await page.evaluate(() => window.__calls.review[0]);
    expect(sent.id).toBe('srv-1');
    expect(Object.keys(sent.body).sort()).toEqual(['decision', 'evidence', 'reason']);
  });
});
