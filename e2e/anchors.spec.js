// Journey: in-page links, deep links and Back/Forward between anchors (Issue #190).
const { test, expect } = require('./fixtures');

// Distance of an element's top edge from the top of the viewport.
const topOf = (page, id) => page.evaluate((i) => Math.round(document.getElementById(i).getBoundingClientRect().top), id);

// scroll-margin-top is 5rem (80px). Anything between "tucked against the edge" and "far down" is the target in view.
async function expectNearTop(page, id) {
  await expect.poll(() => topOf(page, id), { message: `#${id} should sit just below the top of the window` }).toBeGreaterThan(40);
  expect(await topOf(page, id)).toBeLessThan(140);
}

test.describe('deep links', () => {
  test('a direct load of /pages/contact.html#contact-form shows the form with space above it', async ({ page }) => {
    await page.goto('/pages/contact.html#contact-form');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await expectNearTop(page, 'contact-form');
    await expect(page).toHaveURL(/#contact-form$/);
  });

  test('a deep link on the home page waits for the splash screen and then scrolls', async ({ browser, baseURL }) => {
    // The home page keeps its content hidden behind a 3 second splash screen unless reduced motion is on,
    // and the playwright config switches motion off, so this one test switches it back on.
    const context = await browser.newContext({ baseURL, reducedMotion: 'no-preference', viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      await page.addInitScript(() => localStorage.setItem('relief_onboarding_status', JSON.stringify({ status: 'skipped', timestamp: 0 })));
      await page.goto('/index.html#how-it-works');
      await expect(page.locator('.splash-screen')).toBeAttached();
      await expect(page.locator('.main-content')).toBeVisible({ timeout: 10000 });
      await expectNearTop(page, 'how-it-works');
    } finally {
      await context.close();
    }
  });

  test('a hash that matches nothing, or is not a valid selector, loads the page normally', async ({ page }) => {
    for (const hash of ['#nope', '#1bad:selector[', '#%E0%A4%A']) {
      await page.goto('/pages/contact.html' + hash);
      await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
      expect(await page.evaluate(() => window.scrollY), hash).toBe(0);
    }
  });

  test('clicking a link with a hash that is not a valid selector does not throw', async ({ page }) => {
    await page.goto('/pages/contact.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    // An uncaught error fails the test (see fixtures.js).
    await page.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<a id="bad-link" href="#1bad:selector[">bad</a>');
    });
    await page.locator('#bad-link').click({ force: true });
    await expect(page).toHaveURL(/#1bad:selector\[$/);
  });
});

test.describe('in-page links and history', () => {
  test('each anchor click is a history entry, so Back and Forward move between sections', async ({ page }) => {
    await page.goto('/pages/contact.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });

    await page.locator('a[href="#contact-form"]').first().click();
    await expect(page).toHaveURL(/#contact-form$/);
    await expectNearTop(page, 'contact-form');

    await page.locator('a[href="#map"]').first().click();
    await expect(page).toHaveURL(/#map$/);
    await expectNearTop(page, 'map');

    await page.goBack();
    await expect(page).toHaveURL(/#contact-form$/);
    await expectNearTop(page, 'contact-form');

    await page.goBack();
    await expect(page).toHaveURL(/\/pages\/contact\.html$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);

    await page.goForward();
    await expect(page).toHaveURL(/#contact-form$/);
    await page.goForward();
    await expect(page).toHaveURL(/#map$/);
    await expectNearTop(page, 'map');
  });

  test('Back from another page and a reload keep the scroll position instead of jumping to the hash', async ({ page }) => {
    await page.goto('/pages/contact.html#contact-form');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    // Scroll well past the target, so a jump back to it would be easy to see.
    const y = await page.evaluate(() => {
      window.scrollTo(0, document.getElementById('map').offsetTop + 300);
      return window.scrollY;
    });
    expect(y).toBeGreaterThan(await page.evaluate(() => document.getElementById('contact-form').offsetTop + 200));

    await page.goto('/pages/about.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.goBack();
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/pages\/contact\.html#contact-form$/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);

    await page.reload();
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(y);
  });

  test('the About page "our story" link works the same way', async ({ page }) => {
    await page.goto('/pages/about.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.locator('a[href="#our-story"]').first().click();
    await expect(page).toHaveURL(/#our-story$/);
    await expectNearTop(page, 'our-story');
    await page.goBack();
    await expect(page).toHaveURL(/\/pages\/about\.html$/);
  });

  test('a placeholder "#" link neither jumps to the top nor adds a history entry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/pages/about.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => [history.length, window.scrollY]);
    await page.locator('a[href="#"]').first().dispatchEvent('click');
    const after = await page.evaluate(() => [history.length, window.scrollY, location.hash]);
    expect(after).toEqual([before[0], before[1], '']);
  });

  test('the skip link still moves focus to the main landmark', async ({ page }) => {
    await page.goto('/pages/contact.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator('#main-content')).toBeFocused();
  });
});
