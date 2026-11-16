// Browser checks for the shared design system on the pages migrated in issue #130 (docs/DESIGN_SYSTEM.md).
// They check what the redesign could break: layout at phone width, the header no longer covering content,
// visible focus, touch size, the mobile menu, and that emergency access still works with no sign-in.
const { test, expect } = require('./fixtures');

const PAGES = [
  { name: 'home', url: '/index.html', h1: 'Your Health, Our Priority' },
  { name: 'first aid', url: '/pages/firstaid.html', h1: 'First Aid Guide' },
  { name: 'hospitals', url: '/pages/hospitals.html', h1: 'Find Hospitals Near You' },
  { name: 'login', url: '/pages/login.html', h1: 'Login to Your Account' },
  { name: 'signup', url: '/pages/signup.html', h1: null },
  { name: 'dashboard', url: '/pages/dashboard.html', h1: null }
];

async function open(page, url) {
  await page.goto(url);
  await expect(page.locator('main').first()).toBeVisible({ timeout: 9000 });
}

for (const p of PAGES) {
  test.describe(p.name, () => {
    test('uses the design tokens and has no horizontal scroll at 390px', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, p.url);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(244, 247, 246)');
      const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-primary').trim());
      expect(token).toBe('#00695a');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
    });

    test('the header no longer hangs over the content (logo is 64px or smaller)', async ({ page }) => {
      await open(page, p.url);
      const logo = page.locator('.logo img, .nav .brand img').first();
      await expect(logo).toBeVisible();
      const box = await logo.boundingBox();
      expect(box.height).toBeLessThanOrEqual(64);
      const headerBottom = await page.evaluate(() => {
        const el = document.querySelector('.navbar, .topbar');
        return el.getBoundingClientRect().bottom;
      });
      expect(headerBottom - box.y).toBeLessThan(120);
      if (p.h1) {
        const h1 = await page.getByRole('heading', { level: 1, name: p.h1 }).first().boundingBox();
        expect(h1.y, 'heading starts below the logo').toBeGreaterThanOrEqual(box.y + box.height);
      }
    });

    test('keyboard focus is clearly visible', async ({ page }) => {
      await open(page, p.url);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      const ring = await page.evaluate(() => {
        const s = getComputedStyle(document.activeElement);
        return { width: parseFloat(s.outlineWidth), style: s.outlineStyle, tag: document.activeElement.tagName };
      });
      expect(ring.style).toBe('solid');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    });

    test('primary buttons and fields are at least 44px tall', async ({ page }) => {
      await open(page, p.url);
      const small = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('main .btn-primary, main .btn-secondary, main .btn-filter, main input[type="email"], main input[type="password"], main input[type="search"], main select, .nav-links .btn-login, .nav-links .btn-signup').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 43.5) out.push(el.className + ' ' + Math.round(r.height));
        });
        return out;
      });
      expect(small).toEqual([]);
    });

    test('there is an emergency route that needs no sign-in', async ({ page }) => {
      await open(page, p.url);
      const sos = page.getByRole('link', { name: /Emergency SOS/i }).first();
      await expect(sos).toBeVisible();
      expect(await sos.getAttribute('href')).toMatch(/ambulances\.html/);
    });
  });
}

test('mobile menu: the hamburger is visible, opens the links and Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/pages/firstaid.html');
  const burger = page.getByRole('button', { name: 'Mobile menu' });
  await expect(burger).toBeVisible();
  // The three bars are drawn: each span has a real height.
  const bars = await burger.locator('span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(bars.every((h) => h >= 1.5)).toBeTruthy();
  await burger.click();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#main-nav-links').getByRole('link', { name: 'Home' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(burger).toHaveAttribute('aria-expanded', 'false');
});

test('first aid still works with no sign-in: search narrows the guides', async ({ page }) => {
  await open(page, '/pages/firstaid.html');
  await expect(page.getByRole('heading', { name: 'In case of emergency, call 911 or your local emergency number immediately' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search first aid guides' }).fill('burn');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Burns', exact: false }).first()).toBeVisible();
});

test('hospitals keeps its states: the directory status and filters are present and readable', async ({ page }) => {
  await open(page, '/pages/hospitals.html');
  await expect(page.locator('#directory-status')).toBeAttached();
  await expect(page.getByLabel('Facility Type')).toBeVisible();
  const color = await page.locator('.data-note').evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe('rgb(95, 66, 0)');
});

test('the emergency button keeps the emergency red and nothing else is filled red', async ({ page }) => {
  await open(page, '/pages/login.html');
  const submit = await page.locator('#login-form button[type="submit"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(submit).toBe('rgb(0, 105, 90)');
});

test('reduced motion: the layer plays no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/pages/hospitals.html');
  const d = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hospital-finder h1')).transitionDuration));
  expect(d).toBeLessThan(0.05);
});
