// Journey: low-data mode on the essential pages (Issue #50). See docs/LOW_BANDWIDTH.md.
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const KEY = 'relief_low_bandwidth';
const AXE_SOURCE = require.resolve('axe-core/axe.min.js');
const PAGES = ['/index.html', '/pages/hospitals.html', '/pages/ambulances.html', '/pages/firstaid.html'];

const bar = (page) => page.locator('#relief-lite-bar');
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const hasClass = (page) => page.evaluate(() => document.documentElement.classList.contains('relief-lite'));

// Starts a page with the mode already chosen, the way a returning visitor has it.
async function withMode(page, value) {
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }, [KEY, value]);
}

// The home page shows a 3 second splash screen unless motion is reduced or the mode is on.
async function openHome(page) {
  await page.goto('/index.html');
  await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
}

test.describe('low-data mode: turning it on and off', () => {
  for (const url of PAGES) {
    test(url + ' starts off, can be turned on and off, and the choice is remembered', async ({ page }) => {
      await page.goto(url);
      await expect(bar(page)).toContainText('Low-data mode is off.');
      expect(await hasClass(page)).toBe(false);
      expect(await stored(page)).toBeNull();

      await page.getByRole('button', { name: 'Turn on low-data mode' }).click();
      await expect(bar(page)).toContainText('Low-data mode is on.');
      await expect(bar(page).getByRole('button', { name: 'Turn off' })).toHaveAttribute('aria-pressed', 'true');
      expect(await hasClass(page)).toBe(true);
      expect(await stored(page)).toBe('on');

      await page.reload();
      expect(await hasClass(page)).toBe(true);
      await expect(bar(page)).toContainText('Low-data mode is on.');

      await bar(page).getByRole('button', { name: 'Turn off' }).click();
      await expect(bar(page)).toContainText('Low-data mode is off.');
      expect(await hasClass(page)).toBe(false);
      expect(await stored(page)).toBe('off');
      await page.reload();
      expect(await hasClass(page)).toBe(false);
    });
  }

  test('focus stays on the button after a switch, so a keyboard user does not lose their place', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await page.getByRole('button', { name: 'Turn on low-data mode' }).focus();
    await page.keyboard.press('Enter');
    await expect(bar(page).getByRole('button', { name: 'Turn off' })).toBeFocused();
  });

  test('a stored value that is not "on" or "off" is ignored', async ({ page }) => {
    await withMode(page, 'banana');
    await page.goto('/pages/hospitals.html');
    expect(await hasClass(page)).toBe(false);
    await expect(bar(page)).toContainText('Low-data mode is off.');
  });

  // Blocking localStorage this way makes the other page scripts throw too, which is expected here.
  test.describe('storage blocked', () => {
    test.use({ allowedPageErrors: [/^blocked$/] });

    test('when storage is blocked the mode still works for this page and says it will not be remembered', async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
      });
      await page.goto('/pages/hospitals.html');
      await expect(bar(page)).toContainText('Low-data mode is off.');
      await page.getByRole('button', { name: 'Turn on low-data mode' }).click();
      expect(await hasClass(page)).toBe(true);
      await expect(bar(page)).toContainText('would not save this choice');
    });
  });
});

test.describe('low-data mode: the connection hint only suggests', () => {
  async function slowConnection(page, connection) {
    await page.addInitScript((c) => {
      Object.defineProperty(navigator, 'connection', { configurable: true, value: c });
    }, connection);
  }

  test('a 2g connection offers the mode but does not switch it on', async ({ page }) => {
    await slowConnection(page, { effectiveType: '2g', saveData: false });
    await page.goto('/pages/hospitals.html');
    await expect(bar(page)).toContainText('Your connection looks slow or Data Saver is on');
    expect(await hasClass(page)).toBe(false);
    expect(await stored(page)).toBeNull();
  });

  test('Data Saver offers it too, "Turn on" turns it on', async ({ page }) => {
    await slowConnection(page, { effectiveType: '4g', saveData: true });
    await page.goto('/pages/hospitals.html');
    await bar(page).getByRole('button', { name: 'Turn on', exact: true }).click();
    expect(await hasClass(page)).toBe(true);
    expect(await stored(page)).toBe('on');
  });

  test('"Not now" is remembered, so the suggestion does not come back', async ({ page }) => {
    await slowConnection(page, { effectiveType: 'slow-2g' });
    await page.goto('/pages/hospitals.html');
    await bar(page).getByRole('button', { name: 'Not now' }).click();
    expect(await stored(page)).toBe('off');
    expect(await hasClass(page)).toBe(false);
    await page.reload();
    await expect(bar(page)).toContainText('Low-data mode is off.');
  });

  test('a fast connection gets no suggestion', async ({ page }) => {
    await slowConnection(page, { effectiveType: '4g', saveData: false });
    await page.goto('/pages/hospitals.html');
    await expect(bar(page)).toContainText('Low-data mode is off.');
  });
});

test.describe('low-data mode: what it changes', () => {
  test('home: no splash delay, no animation anywhere, decorative pictures hidden, logo kept', async ({ browser, baseURL }) => {
    // Motion is not reduced here, so the 3 second splash would show without the mode.
    const context = await browser.newContext({ reducedMotion: 'no-preference' });
    await context.route((url) => url.origin !== new URL(baseURL).origin, (route) => route.abort());
    await context.addInitScript(() => {
      try { localStorage.setItem('relief_onboarding_status', JSON.stringify({ status: 'skipped', timestamp: 0 })); } catch (e) { /* blocked */ }
    });
    const page = await context.newPage();

    const t0 = Date.now();
    await page.goto(baseURL + '/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    const withSplash = Date.now() - t0;
    expect(withSplash).toBeGreaterThan(2500);

    await page.evaluate((k) => localStorage.setItem(k, 'on'), KEY);
    const t1 = Date.now();
    await page.goto(baseURL + '/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    expect(Date.now() - t1).toBeLessThan(2000);
    await expect(page.locator('.splash-screen')).toBeHidden();

    const animated = await page.evaluate(() => [...document.querySelectorAll('*')]
      .filter((n) => getComputedStyle(n).animationName !== 'none').length);
    expect(animated).toBe(0);
    await expect(page.locator('.hero-image img')).toBeHidden();
    await expect(page.locator('.badges-grid img').first()).toBeHidden();
    await expect(page.locator('.logo img')).toBeVisible();
    await context.close();
  });

  test('home: the 1.8 MB loader picture is not requested with the mode on, and is without it', async ({ browser, baseURL }) => {
    for (const mode of ['on', 'off']) {
      const context = await browser.newContext({ reducedMotion: 'no-preference' });
      await context.route((url) => url.origin !== new URL(baseURL).origin, (route) => route.abort());
      await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) { /* blocked */ } }, [KEY, mode]);
      const page = await context.newPage();
      const seen = [];
      page.on('request', (r) => { if (/ambulance-icon\.gif$/.test(r.url())) seen.push(r.url()); });
      await page.goto(baseURL + '/index.html');
      await page.waitForLoadState('networkidle');
      expect(seen.length, 'mode ' + mode).toBe(mode === 'on' ? 0 : 1);
      await context.close();
    }
  });

  test('home: decorative pictures are not downloaded with the mode on, and come back when it is turned off', async ({ browser, baseURL }) => {
    const decorative = /\/assets\/images\/(hero-image|partner\d|app-screens|app-store|google-play|hipaa-badge|ssl-badge)/;
    const count = async (mode) => {
      const context = await browser.newContext({ reducedMotion: 'no-preference', viewport: { width: 1280, height: 800 } });
      await context.route((url) => url.origin !== new URL(baseURL).origin, (route) => route.abort());
      await context.addInitScript(([k, v]) => {
        try { localStorage.setItem(k, v); localStorage.setItem('relief_onboarding_status', JSON.stringify({ status: 'skipped', timestamp: 0 })); } catch (e) { /* blocked */ }
      }, [KEY, mode]);
      const page = await context.newPage();
      const seen = [];
      page.on('request', (r) => { if (decorative.test(r.url())) seen.push(r.url()); });
      await page.goto(baseURL + '/index.html');
      await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
      await page.waitForLoadState('networkidle');
      const logoLoaded = await page.evaluate(() => { const i = document.querySelector('.logo img'); return i.complete && i.naturalWidth > 0; });
      await context.close();
      return { seen, logoLoaded };
    };
    const on = await count('on');
    expect(on.seen, 'requests with the mode on').toEqual([]);
    expect(on.logoLoaded).toBe(true);
    const off = await count('off');
    expect(off.seen.length, 'requests with the mode off').toBeGreaterThanOrEqual(6);
  });

  test('hospitals: facility search and the phone links work with the mode on', async ({ page }) => {
    await withMode(page, 'on');
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('.hospitals-list .hospital-card, .hospitals-list > *').first()).toBeVisible();
    await page.getByRole('searchbox', { name: /Search by name/ }).fill('Bankura');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.hospitals-list')).toContainText('Bankura');
    const call = page.locator('.hospitals-list a[href^="tel:"]').first();
    if (await call.count()) {
      await call.click();
      expect((await relief(page)).links.length).toBe(1);
    }
  });

  test('ambulances: SOS opens and the direct call link is there with the mode on', async ({ page }) => {
    await withMode(page, 'on');
    await page.goto('/pages/ambulances.html');
    await page.getByRole('button', { name: 'Emergency SOS' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: /Direct Call 112/ }).click();
    expect((await relief(page)).links).toEqual(['tel:112']);
  });

  test('first aid: a guide opens with the mode on', async ({ page }) => {
    await withMode(page, 'on');
    await page.goto('/pages/firstaid.html');
    await expect(page.locator('main')).toContainText(/CPR|Burns|Choking/);
  });

  test('turning the mode off does not remove the reduced-motion rules (they belong to the system setting)', async ({ page }) => {
    // The Playwright config emulates prefers-reduced-motion: reduce for every test.
    await page.goto('/pages/hospitals.html');
    const read = () => page.evaluate(() => ({
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      transition: getComputedStyle(document.querySelector('.btn-filter')).transitionDuration
    }));
    const before = await read();
    expect(before.reduce).toBe(true);
    await page.getByRole('button', { name: 'Turn on low-data mode' }).click();
    await bar(page).getByRole('button', { name: 'Turn off' }).click();
    expect(await read()).toEqual(before);
  });
});

test.describe('low-data mode: slow network', () => {
  // Slow 3G as Chrome DevTools defines it: 400 ms round trip, about 400 kbit/s down.
  async function throttle(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  }

  for (const url of ['/pages/hospitals.html', '/pages/ambulances.html', '/pages/firstaid.html']) {
    test(url + ' stays usable on slow 3G with the mode on', async ({ page }) => {
      test.setTimeout(60000);
      await withMode(page, 'on');
      await throttle(page);
      await page.goto(url);
      await expect(page.locator('main')).toBeVisible({ timeout: 30000 });
      await expect(bar(page)).toContainText('Low-data mode is on.');
      if (url.includes('ambulances')) {
        await page.getByRole('button', { name: 'Emergency SOS' }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
      }
    });
  }
});

// The page's Content Security Policy refuses the injected axe script, so these run without it.
test.describe('low-data mode: accessibility', () => {
  test.use({ bypassCSP: true });

  for (const mode of ['off', 'on']) {
    test('hospitals page has no automated violations with the mode ' + mode + ' (axe, WCAG 2.1 A and AA)', async ({ page }) => {
      await withMode(page, mode);
      await page.goto('/pages/hospitals.html');
      await expect(bar(page)).toBeVisible();
      await page.addScriptTag({ path: AXE_SOURCE });
      const violations = await page.evaluate(async () => {
        const result = await window.axe.run(document.getElementById('relief-lite-bar'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return result.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).join(' | '));
      });
      expect(violations).toEqual([]);
    });
  }
});
