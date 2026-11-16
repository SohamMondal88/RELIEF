// Journey: a request that never finishes ends in a message and a Try again button, not in "Loading..." for ever.
// Covers the local data files that the health events page and the admin freshness list read, and the place lookup
// (the latter is in network-resilience.spec.js). Nothing leaves the site: the stall is a page.route that never answers.
const { test, expect } = require('./fixtures');

// Never answers the first request for `matcher`, lets every later one through to the static server.
async function stallFirstRequest(page, matcher) {
  const state = { requests: 0 };
  await page.route(matcher, (route) => {
    state.requests += 1;
    if (state.requests === 1) return undefined; // held: neither answered nor continued
    return route.continue();
  });
  return state;
}

test.describe('local data that never answers', () => {
  test.beforeEach(() => { test.setTimeout(60000); });

  test('health events: gives up, says why, and Try again loads the list', async ({ page }) => {
    const seed = await stallFirstRequest(page, '**/assets/data/health-events.json');
    await page.goto('/pages/health-events.html');
    await expect(page.locator('#events-loading')).toBeVisible();

    const error = page.locator('#events-error');
    await expect(error).toBeVisible({ timeout: 20000 });
    await expect(error).toContainText('Events could not be loaded');
    await expect(error).toContainText('taking too long');
    await expect(page.locator('#events-loading')).toBeHidden();

    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.event-card').first()).toBeVisible();
    await expect(error).toBeHidden();
    await expect(page.locator('#events-list')).toHaveAttribute('aria-busy', 'false');
    expect(seed.requests).toBe(2);
  });

  test('admin facility freshness list: gives up, says why, and Try again loads the table', async ({ page }) => {
    const data = await stallFirstRequest(page, '**/assets/data/facilities.json');
    await page.goto('/pages/admin-panel.html');
    const message = page.locator('#freshness-message');
    await expect(message).toContainText('Loading facility records');

    await expect(message).toContainText('could not be loaded', { timeout: 20000 });
    await expect(message).toContainText('taking too long');
    await expect(message).toHaveAttribute('data-tone', 'error');
    const retry = page.getByRole('button', { name: 'Try again' }).filter({ visible: true });
    await expect(retry).toHaveCount(1);

    await retry.click();
    await expect(page.locator('#freshness-counts li').first()).toBeVisible();
    await expect(message).not.toHaveAttribute('data-tone', 'error');
    await expect(retry).toBeHidden();
    expect(data.requests).toBe(2);
  });
});
