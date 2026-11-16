// Emergency actions on small screens (Issue #121): the floating Emergency SOS button, Back to top, the language
// switcher and the offline banner, the SOS dialog and the first-visit tour's emergency banner, on a phone held upright
// and sideways. Nothing leaves the local site (fixtures.js): the SOS endpoint is a same-origin path answered by page.route.
const { test, expect } = require('./fixtures');
const { showTour, relief } = require('./helpers');

const FAB = '.relief-sos-fab';
const STICKY = '.relief-sos-fab, .back-to-top-btn, .relief-lang-switch--floating';

const SIZES = [
  { name: 'phone upright 375x667', width: 375, height: 667 },
  { name: 'phone sideways 667x375', width: 667, height: 375 }
];

// Fake notch and home-indicator sizes (an iPhone held upright and sideways). Chromium only, through the DevTools protocol.
async function useSafeArea(page, insets) {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets });
}

const box = (locator) => locator.evaluate((el) => {
  const b = el.getBoundingClientRect();
  return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
});
const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);

// The control is on screen and the element the browser finds at its centre is the control itself.
async function expectReachable(locator, label) {
  const result = await locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return {
      inside: b.left >= 0 && b.top >= 0 && b.right <= document.documentElement.clientWidth + 0.5 && b.bottom <= window.innerHeight + 0.5,
      onTop: !!top && (top === el || el.contains(top)),
      cover: top ? top.tagName.toLowerCase() + '.' + String(top.className) : 'nothing',
      box: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]
    };
  });
  expect(result.inside, label + ' is not fully on the screen: ' + result.box.join(',')).toBe(true);
  expect(result.onTop, label + ' is covered by ' + result.cover).toBe(true);
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: true });

    test('the Emergency SOS button is reachable, big enough, and apart from Back to top', async ({ page }) => {
      await page.goto('/pages/hospitals.html');
      const fab = page.locator(FAB);
      await expectReachable(fab, 'Emergency SOS button');
      const fabBox = await box(fab);
      expect(fabBox.width).toBeGreaterThanOrEqual(44);
      expect(fabBox.height).toBeGreaterThanOrEqual(44);

      await page.evaluate(() => window.scrollTo(0, 600));
      const backToTop = page.locator('.back-to-top-btn.is-visible');
      await expect(backToTop).toBeVisible();
      await expectReachable(backToTop, 'Back to top');
      expect(overlap(await box(backToTop), await box(fab)), 'Back to top sits on the Emergency SOS button').toBe(false);
    });

    test('the Emergency SOS button is a link: it opens the ambulances page and sends nothing', async ({ page, problems }) => {
      await page.goto('/pages/hospitals.html');
      await page.locator(FAB).tap();
      await expect(page).toHaveURL(/pages\/ambulances\.html$/);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(problems.blocked.filter((request) => request.startsWith('POST'))).toEqual([]);
      const guard = await relief(page);
      expect(guard.opened).toEqual([]);
      expect(guard.links).toEqual([]);
    });

    // Tab and focus() both scroll the focused control into view. Before the fix it could end up underneath the button.
    for (const route of ['/pages/ambulances.html', '/pages/contact.html', '/pages/appointments.html']) {
      test('keyboard focus never lands under a fixed button on ' + route, async ({ page }) => {
        await page.goto(route);
        const hidden = await page.evaluate(async (sticky) => {
          const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
          const controls = Array.from(document.querySelectorAll(selector)).filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]') && !el.disabled && !el.matches(sticky);
          });
          const covered = [];
          for (const el of controls) {
            el.focus();
            await new Promise((resolve) => setTimeout(resolve, 20));
            const b = el.getBoundingClientRect();
            // A control of button or field size must not be even partly under a fixed button that is showing. A tall one (a
            // big text area) cannot always be moved clear, so for it the middle must stay free.
            const small = b.height <= 80;
            const under = Array.from(document.querySelectorAll(sticky)).find((fixed) => {
              if (getComputedStyle(fixed).visibility === 'hidden') return false;
              const f = fixed.getBoundingClientRect();
              if (small) return !(b.right <= f.left || f.right <= b.left || b.bottom <= f.top || f.bottom <= b.top);
              const x = b.left + b.width / 2;
              const y = b.top + b.height / 2;
              return x >= f.left && x <= f.right && y >= f.top && y <= f.bottom;
            });
            if (under) covered.push(el.tagName.toLowerCase() + ' "' + (el.id || el.textContent.trim().slice(0, 25)) + '" under ' + under.className);
          }
          return { checked: controls.length, covered };
        }, STICKY);
        expect(hidden.checked).toBeGreaterThan(5);
        expect(hidden.covered, 'focused controls under a fixed button').toEqual([]);
      });
    }

    test('with a notch and a home indicator the fixed buttons keep clear of them', async ({ page }) => {
      const insets = size.width > size.height
        ? { top: 0, bottom: 21, left: 47, right: 47 }
        : { top: 47, bottom: 34, left: 0, right: 0 };
      await useSafeArea(page, insets);
      await page.goto('/pages/dashboard.html'); // has the floating language switcher too
      const fab = await box(page.locator(FAB));
      expect(size.height - fab.bottom, 'Emergency SOS button inside the bottom inset').toBeGreaterThanOrEqual(insets.bottom);
      expect(size.width - fab.right, 'Emergency SOS button inside the right inset').toBeGreaterThanOrEqual(insets.right);
      const lang = await box(page.locator('.relief-lang-switch--floating'));
      expect(size.height - lang.bottom, 'language switcher inside the bottom inset').toBeGreaterThanOrEqual(insets.bottom);
      expect(lang.left, 'language switcher inside the left inset').toBeGreaterThanOrEqual(insets.left);
      expect(overlap(lang, fab), 'language switcher and Emergency SOS button overlap').toBe(false);

      await page.evaluate(() => window.scrollTo(0, 800));
      const backToTop = page.locator('.back-to-top-btn.is-visible');
      await expect(backToTop).toBeVisible();
      const up = await box(backToTop);
      expect(size.height - up.bottom).toBeGreaterThanOrEqual(insets.bottom);
      expect(size.width - up.right).toBeGreaterThanOrEqual(insets.right);
      expect(overlap(up, fab), 'Back to top sits on the Emergency SOS button').toBe(false);
    });

    test('the offline banner keeps its text below the notch', async ({ page }) => {
      test.skip(size.width > size.height, 'the top inset is 0 when the phone is held sideways');
      await useSafeArea(page, { top: 47, bottom: 34, left: 0, right: 0 });
      await page.goto('/pages/firstaid.html');
      await page.context().setOffline(true);
      const banner = page.locator('#relief-offline-banner');
      await expect(banner).toBeVisible();
      const paddingTop = await banner.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
      expect(paddingTop).toBeGreaterThanOrEqual(47);
    });

    test('a first-visit tour: its emergency banner and every button can be reached', async ({ page }) => {
      await showTour(page);
      await page.goto('/index.html');
      const dialog = page.locator('.relief-onboarding-dialog');
      await expect(dialog).toBeVisible({ timeout: 10000 });
      // Scroll each one to the middle of the screen, the way a person scrolls the tour, then check it is really there.
      for (const [label, locator] of [
        ['Emergency SOS link in the tour banner', dialog.locator('.relief-onboarding-emergency-btn')],
        ['Close button', dialog.locator('.relief-onboarding-close')],
        ['Skip Tour button', dialog.locator('.relief-onboarding-btn-skip')],
        ['Next button', dialog.locator('.relief-onboarding-btn-next')]
      ]) {
        await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await expectReachable(locator, label);
      }
    });

    test('SOS needs a deliberate confirm: two quick taps open one dialog and send one request', async ({ page }) => {
      const requests = [];
      await page.addInitScript(() => { window.RELIEF_SOS_ENDPOINT = '/api/sos'; });
      await page.route('**/api/sos', (route) => {
        requests.push(route.request().url());
        return route.fulfill({ status: 503, body: 'down' });
      });
      await page.goto('/pages/ambulances.html');
      const trigger = page.locator('#relief-emergency-sos-trigger');
      await trigger.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const at = await box(trigger);
      const x = at.left + at.width / 2;
      const y = at.top + at.height / 2;
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);

      const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      expect(requests, 'opening the dialog must not send anything').toEqual([]);

      const confirm = dialog.getByRole('button', { name: 'Confirm Emergency SOS Request' });
      await confirm.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      const c = await box(confirm);
      await page.touchscreen.tap(c.left + c.width / 2, c.top + c.height / 2);
      await page.touchscreen.tap(c.left + c.width / 2, c.top + c.height / 2);
      await expect(dialog.getByRole('alert')).toContainText('HTTP 503');
      expect(requests, 'two taps on Confirm must send one request').toHaveLength(1);
      expect((await relief(page)).opened).toEqual([]);
    });
  });
}
