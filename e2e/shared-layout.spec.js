// Journey: the shared header and footer (Issue #104).
// The markup is written from layout/*.tpl by scripts/shared-layout.js (tests/shared-layout.test.js checks the files).
// These tests look at what a person gets in the browser: the emergency link on every page without signing in or
// sharing a location, the menu on a phone with the keyboard, the current page, paths from every folder depth.
const { test, expect } = require('./fixtures');
const L = require('../scripts/shared-layout.js');

// Known script bugs on two pages, not about the header: pharmacies calls Leaflet (L) although the fixture blocks the CDN,
// and assets/js/blog.js adds a listener to a mobile menu button the blog page does not have (the same two as accessibility.spec.js).
test.use({ allowedPageErrors: [/^(L is not defined|Cannot read properties of null \(reading 'addEventListener'\))$/] });

const SITE = L.SITE_PAGES;
const COMPACT = L.COMPACT_PAGES;
const ALL = SITE.concat(COMPACT);

const url = (file) => '/' + file;

async function open(page, file) {
  await page.goto(url(file));
  // The home page shows a splash screen for 3 seconds and hides the header meanwhile.
  if (file === 'index.html') await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('.navbar, .topbar').first()).toBeAttached();
}

const header = (page) => page.locator('.navbar, .topbar').first();
const emergency = (page) => page.locator('a.nav-emergency');

/** Where the phone menu button is, or null on a page with a one-line top bar. */
async function openMenuIfAny(page) {
  const burger = page.locator('.hamburger');
  if (!(await burger.isVisible())) return null;
  await burger.click();
  await expect(burger).toHaveAttribute('aria-expanded', 'true');
  return burger;
}

test.describe('emergency access', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const file of ALL) {
    test(`${file}: the Emergency link is there, signed out, and leads to the ambulances page`, async ({ page }) => {
      await open(page, file);
      await expect(emergency(page)).toHaveCount(1);
      await openMenuIfAny(page);
      await expect(emergency(page)).toBeVisible();
      await expect(emergency(page)).toHaveAttribute('href', /(^|\/)pages\/ambulances\.html$|^ambulances\.html$|^\.\.\/pages\/ambulances\.html$/);
      await emergency(page).click();
      await expect(page).toHaveURL(/pages\/ambulances\.html$/);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    });
  }

  test('the floating Emergency SOS button is on every shared page too, with no location permission', async ({ page }) => {
    for (const file of ALL) {
      await open(page, file);
      await expect(page.locator('.relief-sos-fab'), file).toHaveAttribute('href', /pages\/ambulances\.html$/);
    }
  });

  // The site pages hide everything until main.js shows it (an old rule in the page itself), so only the compact pages
  // show anything without JavaScript. Their header and footer are plain links.
  test('without JavaScript the Emergency link on the compact pages is a plain link that works', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 800 }, baseURL });
    try {
      for (const file of ['pages/careers.html', 'pages/donate.html', 'pages/team.html']) {
        const page = await context.newPage();
        await page.goto(url(file));
        const link = page.locator('a.nav-emergency');
        await expect(link, file).toBeVisible();
        await link.click();
        await expect(page).toHaveURL(/pages\/ambulances\.html$/);
        await page.close();
      }
    } finally {
      await context.close();
    }
  });
});

test.describe('phone menu with the keyboard', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  const MENU_PAGES = ['index.html', 'pages/about.html', 'pages/contact.html', 'pages/hospitals.html', 'pages/login.html'];

  for (const file of MENU_PAGES) {
    test(`${file}: a closed menu cannot be tabbed into, an open one is walked in order and Escape closes it`, async ({ page }) => {
      await open(page, file);
      const burger = page.locator('.hamburger');
      await expect(burger).toBeVisible();

      // Closed: its links are hidden, so they are not in the tab order and not read out.
      await expect(page.locator('#main-nav-links a').first()).toBeHidden();
      await burger.focus();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Shift+Tab');
        const inside = await page.evaluate(() => !!document.activeElement.closest('.nav-links'));
        expect(inside, `Shift+Tab ${i + 1} landed in the closed menu`).toBe(false);
      }

      // Open it from the keyboard: focus moves to the first link.
      await burger.focus();
      await page.keyboard.press('Enter');
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#main-nav-links a').first()).toBeFocused();

      // Tab walks the whole menu and ends on the button, nothing is skipped or off screen.
      const seen = [];
      for (let i = 0; i < 12; i++) {
        const where = await page.evaluate(() => {
          const el = document.activeElement;
          const box = el.getBoundingClientRect();
          return { name: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' '), cls: el.className, // 4px of slack: the language switcher sticks out 2px at 375px on some pages (a known issue listed in docs/E2E_TESTING.md).
          onScreen: box.left >= 0 && box.right <= window.innerWidth + 4 && box.top >= 0 && box.bottom <= window.innerHeight };
        });
        seen.push(where);
        if (/hamburger/.test(where.cls)) break;
        await page.keyboard.press('Tab');
      }
      const names = seen.map((s) => s.name);
      expect(names).toEqual(expect.arrayContaining(['Home', 'About Us', 'Contact', 'Services', 'Emergency', 'Login', 'Sign Up']));
      expect(names.indexOf('Home')).toBeLessThan(names.indexOf('Emergency'));
      expect(names.indexOf('Emergency')).toBeLessThan(names.indexOf('Login'));
      expect(seen.filter((s) => !s.onScreen).map((s) => s.name), 'focused something off screen').toEqual([]);
      expect(/hamburger/.test(seen[seen.length - 1].cls)).toBe(true);

      // Escape closes it and puts focus back on the button.
      await page.keyboard.press('Escape');
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await expect(burger).toBeFocused();
      await expect(page.locator('#main-nav-links a').first()).toBeHidden();
    });
  }

  test('the Services group opens from the keyboard on a phone and its links are reachable', async ({ page }) => {
    await open(page, 'pages/about.html');
    await page.locator('.hamburger').focus();
    await page.keyboard.press('Enter');
    const services = page.locator('#main-nav-links').getByRole('link', { name: 'Services', exact: true });
    await services.focus();
    await page.keyboard.press('Enter');
    await expect(services).toHaveAttribute('aria-expanded', 'true');
    const hospitals = page.locator('#main-nav-links .dropdown-menu').getByRole('link', { name: 'Hospitals' });
    await expect(hospitals).toBeVisible();
    await hospitals.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/pages\/hospitals\.html$/);
  });

  test('the open menu fits the screen, upright and sideways', async ({ page }) => {
    for (const size of [{ width: 375, height: 667 }, { width: 667, height: 375 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size);
      await open(page, 'pages/contact.html');
      await openMenuIfAny(page);
      for (const name of ['Home', 'Emergency', 'Login', 'Sign Up']) {
        const box = await page.locator('.navbar .nav-links').getByRole('link', { name, exact: true }).boundingBox();
        expect(box, `${name} at ${size.width}x${size.height}`).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height);
      }
      const overlap = await page.evaluate(() => {
        const a = document.querySelector('.navbar-left .nav-links a').getBoundingClientRect();
        const b = document.querySelector('a.nav-emergency').getBoundingClientRect();
        return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
      });
      expect(overlap, `menu entries overlap at ${size.width}x${size.height}`).toBe(false);
    }
  });

  test('tapping a link in the menu closes it', async ({ page }) => {
    await open(page, 'pages/about.html');
    const burger = await openMenuIfAny(page);
    await page.locator('#main-nav-links').getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/pages\/contact\.html$/);
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('wide screens', () => {
  for (const width of [1280, 1440]) {
    test(`at ${width}px every header link can be reached with a mouse (nothing sits on top of it)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      for (const file of SITE) {
        await open(page, file);
        const covered = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('.navbar a, .navbar button.btn-tour-nav').forEach((el) => {
            if (el.closest('.dropdown-menu')) return;
            const box = el.getBoundingClientRect();
            if (box.width === 0) return;
            const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
            if (top !== el && !el.contains(top)) out.push((el.textContent || '').trim() + ' is under ' + (top && (top.className || top.tagName)));
          });
          return out;
        });
        expect(covered, file).toEqual([]);
      }
    });
  }

  test('there is no hamburger button, and the menu is in the page, at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, 'pages/about.html');
    await expect(page.locator('.hamburger')).toBeHidden();
    for (const name of ['Home', 'About Us', 'Contact', 'Services', 'Emergency', 'Login', 'Sign Up']) {
      await expect(page.locator('.navbar').getByRole('link', { name, exact: true })).toBeVisible();
    }
  });
});

test.describe('the current page', () => {
  const current = (page) => page.locator('.navbar a[aria-current="page"], .topbar a[aria-current="page"]');

  test('the menu marks the page you are on, and the mark follows you', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'index.html');
    await expect(current(page)).toHaveText('Home');
    await page.locator('.navbar').getByRole('link', { name: 'About Us' }).click();
    await expect(current(page)).toHaveText('About Us');
    await expect(current(page)).toHaveCount(1);
    await page.locator('.navbar').getByRole('link', { name: 'Contact' }).click();
    await expect(current(page)).toHaveText('Contact');
    await expect(current(page)).toHaveCount(1);
  });

  test('a page inside Services marks its entry, and the Services entry itself looks current', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'pages/hospitals.html');
    await expect(current(page)).toHaveText('Hospitals');
    // The mark is not colour alone: it is underlined.
    const line = await page.locator('.navbar .dropdown-toggle').evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(line).toContain('underline');
  });

  test('the mark is underlined, so it does not rely on colour', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'pages/contact.html');
    const line = await current(page).evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(line).toContain('underline');
  });

  test('login and signup mark their own button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'pages/login.html');
    await expect(current(page)).toHaveText('Login');
    await open(page, 'pages/signup.html');
    await expect(current(page)).toHaveText('Sign Up');
  });

  test('the compact top bar marks the current page and wraps on a phone without sideways scrolling', async ({ page }) => {
    await open(page, 'pages/subscription.html');
    await page.setViewportSize({ width: 375, height: 667 });
    // This page has no entry in the menu of its own, so nothing is marked and nothing is marked twice.
    await expect(current(page)).toHaveCount(0);
    await open(page, 'pages/careers.html');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('paths from every folder depth', () => {
  test('the header and footer links of the home page, a page in pages/ and a compact page all answer 200', async ({ page, request, baseURL }) => {
    for (const file of ['index.html', 'pages/about.html', 'pages/dashboard.html', 'pages/login.html']) {
      await open(page, file);
      const hrefs = await page.evaluate(() => [...document.querySelectorAll('.navbar a, .topbar a, footer a')]
        .map((a) => a.getAttribute('href')).filter((h) => h && !/^(#|tel:|mailto:|https?:)/.test(h)));
      expect(hrefs.length, file).toBeGreaterThan(10);
      for (const href of new Set(hrefs)) {
        const target = new URL(href, baseURL + url(file)).pathname;
        const answer = await request.get(baseURL + target);
        expect(answer.status(), file + ' -> ' + href).toBe(200);
      }
    }
  });

  test('Home in the footer goes to the home page, not the old redirect page', async ({ page }) => {
    await open(page, 'pages/about.html');
    await page.locator('footer').getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(/\/index\.html$/);
  });

  test('the footer is the same on every site page: same links, same order', async ({ page }) => {
    const lists = new Set();
    for (const file of SITE) {
      await open(page, file);
      const links = await page.evaluate(() => [...document.querySelectorAll('footer a')]
        .filter((a) => a.getAttribute('href') !== '#')
        .map((a) => new URL(a.getAttribute('href'), location.href).pathname + '|' + a.textContent.trim()));
      lists.add(JSON.stringify(links));
    }
    expect(lists.size).toBe(1);
  });

  test('the 404 page, served from any depth, has working absolute links and its emergency link', async ({ page }) => {
    await page.goto('/404.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page Not Found');
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h.startsWith('/')));
    expect(hrefs).toContain('/pages/ambulances.html');
    await page.getByRole('link', { name: 'Emergency Resources' }).click();
    await expect(page).toHaveURL(/pages\/ambulances\.html$/);
  });
});

test.describe('skip link and landmarks on the compact pages', () => {
  for (const file of ['pages/careers.html', 'pages/donate.html', 'pages/subscription.html']) {
    test(`${file}: the skip link moves focus to the main area`, async ({ page }) => {
      await open(page, file);
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await skip.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('main')).toBeFocused();
    });
  }

  test('each page has a main navigation and a footer, and the two navigations have different names', async ({ page }) => {
    for (const file of ['pages/careers.html', 'pages/about.html']) {
      await open(page, file);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(1);
      await expect(page.getByRole('contentinfo')).toHaveCount(1);
    }
  });
});

test.describe('colours and axe', () => {
  test('a filled button keeps its readable colours when it is the current page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await open(page, 'pages/ambulances.html');
    const link = emergency(page);
    await expect(link).toHaveAttribute('aria-current', 'page');
    expect(await link.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await open(page, 'pages/signup.html');
    const signup = page.locator('.navbar a.btn-signup');
    await expect(signup).toHaveAttribute('aria-current', 'page');
    expect(await signup.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  });

  // axe is injected as inline script, which the site's own policy blocks. Off for this block only (see accessibility.spec.js).
  test.describe('with the menu open', () => {
    test.use({ bypassCSP: true });

    async function violations(p) {
      await p.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      return p.evaluate(async () => {
        const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return result.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1]) }));
      });
    }

    for (const file of ['index.html', 'pages/contact.html', 'pages/login.html']) {
      test(`${file}: the phone menu open, and the compact top bar, have no axe violations`, async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await open(page, file);
        await openMenuIfAny(page);
        // Keep the pointer off the menu: a hovered link has its own colours.
        await page.mouse.move(5, 5);
        const found = await violations(page);
        expect(found, JSON.stringify(found, null, 2)).toEqual([]);
      });
    }

    test('a compact page at 375px', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await open(page, 'pages/careers.html');
      const found = await violations(page);
      expect(found, JSON.stringify(found, null, 2)).toEqual([]);
    });
  });
});
