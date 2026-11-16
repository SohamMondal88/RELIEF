// Page weight and loading order on home, hospitals and ambulances (Issue #95). See docs/PAGE_WEIGHT.md.
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const IMAGE_FILES = /\.(png|jpe?g|gif|webp)(\?|$)/i;

// Which local picture files a page asks for, and how many bytes they add up to.
function watchImages(page) {
  const seen = [];
  page.on('response', async (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(page.url() === 'about:blank' ? response.url() : page.url()).origin && IMAGE_FILES.test(url.pathname)) {
      seen.push({ path: url.pathname, bytes: (await response.body().catch(() => Buffer.alloc(0))).length });
    }
  });
  return seen;
}

const names = (seen) => [...new Set(seen.filter((s) => s.path.startsWith('/assets/images/')).map((s) => s.path.replace('/assets/images/', '')))].sort();
const scrollThrough = (page) => page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
});

test.describe('home: pictures below the first screen load when you get there', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  // Chrome starts a lazy picture a little before it scrolls into view (about 1250 px on a fast connection),
  // so the partner logos just under the hero may load at once. The ones far down the page must not.
  test('at load the pictures far down the page are not requested, the first screen ones are', async ({ page }) => {
    const seen = watchImages(page);
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.waitForLoadState('networkidle');
    const loaded = names(seen);
    expect(loaded).toEqual(expect.arrayContaining(['hero-image.jpeg', 'logo.jpg']));
    ['app-screens.png', 'app-store.png', 'google-play.png', 'hipaa-badge.webp', 'ssl-badge.jpg'].forEach((file) => {
      expect(loaded, file + ' should wait for the scroll').not.toContain(file);
    });
  });

  test('scrolling to the bottom then loads the rest', async ({ page }) => {
    const seen = watchImages(page);
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await scrollThrough(page);
    await page.waitForLoadState('networkidle');
    expect(names(seen)).toEqual(expect.arrayContaining([
      'app-screens.png', 'app-store.png', 'google-play.png', 'hipaa-badge.webp', 'partner1.png', 'partner2.jpeg', 'partner3.png', 'partner4.png', 'ssl-badge.jpg'
    ]));
  });

  test('the local pictures of a first visit add up to less than 600 KB (they were 2.6 MB)', async ({ page }) => {
    const seen = watchImages(page);
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.waitForLoadState('networkidle');
    const total = seen.reduce((sum, s) => sum + s.bytes, 0);
    expect(total).toBeLessThan(600 * 1024);
  });

  test('pictures that load late do not move the page (layout shift under 0.1)', async ({ page }) => {
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await scrollThrough(page);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => window.__cls)).toBeLessThan(0.1);
  });
});

test.describe('hospitals and ambulances: footer badges are lazy in the browser too', () => {
  for (const url of ['/pages/hospitals.html', '/pages/ambulances.html']) {
    test(url + ' marks the footer badges lazy and leaves the logo alone', async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('main')).toBeVisible();
      const loading = await page.evaluate(() => [...document.images].map((i) => i.getAttribute('src').split('/').pop() + ':' + i.loading));
      expect(loading.sort()).toEqual(['hipaa-badge.webp:lazy', 'logo.jpg:auto', 'ssl-badge.jpg:lazy']);
    });
  }
});

test.describe('the analytics script does not hold up the first paint', () => {
  for (const url of ['/index.html', '/pages/hospitals.html', '/pages/ambulances.html']) {
    test(url + ' paints while the analytics script is still arriving', async ({ page }) => {
      // The script is answered after 2.5 seconds, as it would be on a very slow link.
      await page.route('**/assets/js/vercel-analytics.js', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.continue().catch(() => {});
      });
      await page.goto(url, { waitUntil: 'commit' });
      const fcp = await page.evaluate(() => new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entry = list.getEntriesByName('first-contentful-paint')[0];
          if (entry) resolve(entry.startTime);
        }).observe({ type: 'paint', buffered: true });
      }));
      expect(fcp).toBeLessThan(2000);
    });
  }
});

test.describe('emergency actions and search work with no picture at all', () => {
  test.beforeEach(async ({ page }) => {
    await page.route((url) => IMAGE_FILES.test(url.pathname), (route) => route.abort());
  });

  test('ambulances: SOS opens and the direct call link dials once on a tap', async ({ page }) => {
    await page.goto('/pages/ambulances.html');
    await page.getByRole('button', { name: 'Emergency SOS' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: /Direct Call 112/ }).click();
    expect((await relief(page)).links).toEqual(['tel:112']);
  });

  test('hospitals: the facility search lists matches', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospitals-list > *').first()).toBeVisible();
    await page.getByRole('searchbox', { name: /Search by name/ }).fill('Bankura');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.hospitals-list')).toContainText('Bankura');
  });

  test('home: the search box and the main links are there and usable', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('link', { name: 'Check Symptoms' })).toHaveAttribute('href', /symptoms\.html/);
    await expect(page.getByRole('link', { name: 'Find a Doctor' })).toHaveAttribute('href', /doctors\.html/);
    await expect(page.getByPlaceholder('Search symptoms, doctors, or locations...')).toBeEditable();
  });
});
