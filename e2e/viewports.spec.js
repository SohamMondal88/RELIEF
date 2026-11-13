// Critical healthcare flows at a phone, a tablet and a desktop size (Issue #101).
// Each viewport runs the same journeys: main navigation, emergency access, directory search, an appointment request and
// the dashboard. Besides the behavior, every journey checks that the page does not scroll sideways and that the controls
// it uses are on screen, not covered by something else and big enough to hit.
// Nothing leaves the local site (fixtures.js): location is denied, the SOS endpoint is not configured and outside hosts are blocked.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');
const { relief } = require('./helpers');

const FACILITIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8')).facilities;

const VIEWPORTS = [
  { name: 'phone 375x667', width: 375, height: 667, touch: true, menu: true },
  { name: 'tablet 768x1024', width: 768, height: 1024, touch: true, menu: true },
  { name: 'desktop 1280x800', width: 1280, height: 800, touch: false, menu: false }
];

// Elements that are known to stick out, each tracked by a test.fixme in navigation.spec.js. Remove an entry in the pull
// request that fixes the bug. Do not add one for something you have not looked at.
const KNOWN_OVERFLOW = [
  '.relief-lang-switch' // i18n.js puts the language switcher at right: -54px on small screens
];

// The menu button (.hamburger) is three bars drawn with CSS and measures 18px high, under the 24px minimum. It is
// still visible, on screen and not covered, so it is checked for that only. Remove this when its padding is fixed.
const KNOWN_SMALL_TARGETS = { minSize: 0 };

// Every visible element whose right edge is past the viewport, except known ones, fixed boxes and anything inside a box that
// scrolls sideways on purpose. Empty means the page cannot be pushed sideways by its own content.
async function overflowOffenders(page) {
  return page.evaluate((known) => {
    const width = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll('body *').forEach((el) => {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || box.right <= width + 1) return;
      if (known.some((selector) => el.closest(selector))) return;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      if (style.position === 'fixed') return; // a fixed box never makes the page scroll sideways (a pinned panel or button)
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const overflowX = getComputedStyle(parent).overflowX;
        if (overflowX !== 'visible') return; // clipped or scrollable by its parent, so it cannot widen the page
      }
      const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      offenders.push(name + ' (right edge ' + Math.round(box.right) + 'px, viewport ' + width + 'px)');
    });
    return offenders.slice(0, 8);
  }, KNOWN_OVERFLOW);
}

const expectNoSidewaysScroll = async (page, where) => {
  expect(await overflowOffenders(page), where + ': content wider than the screen').toEqual([]);
};

// The control is on screen, nothing sits on top of it, and it is at least 24 x 24 CSS px (WCAG 2.2, 2.5.8).
// minSize: 0 skips the size rule for a control that is known to be smaller (see KNOWN_SMALL_TARGETS).
async function expectUsable(page, locator, label, { minSize = 24 } = {}) {
  // Centered, so a fixed button in a corner (SOS, language switch) is not what is being tested here.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  await expect(locator, label + ' is visible').toBeVisible();
  const result = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      reachable: !!top && (el === top || el.contains(top)),
      coveredBy: top ? top.tagName.toLowerCase() + (top.className && typeof top.className === 'string' ? '.' + top.className.trim().split(/\s+/).join('.') : '') : 'nothing'
    };
  });
  expect(result.box.left, label + ' starts left of the screen').toBeGreaterThanOrEqual(0);
  expect(result.box.right, label + ' ends right of the screen').toBeLessThanOrEqual(result.viewport.width + 0.5);
  expect(result.reachable, label + ' is covered by ' + result.coveredBy).toBe(true);
  expect(result.box.width, label + ' is too narrow to hit').toBeGreaterThanOrEqual(minSize);
  expect(result.box.height, label + ' is too short to hit').toBeGreaterThanOrEqual(minSize);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });

    // A finger on a touch screen, the mouse on a desktop.
    const press = (locator) => (vp.touch ? locator.tap() : locator.click());

    test('main navigation: the menu button opens the menu on small screens, the links are shown on a wide one', async ({ page }) => {
      await page.goto('/pages/hospitals.html');
      const burger = page.getByRole('button', { name: 'Mobile menu' });
      const links = page.locator('#main-nav-links');
      if (vp.menu) {
        await expectUsable(page, burger, 'menu button', KNOWN_SMALL_TARGETS);
        await expect(burger).toHaveAttribute('aria-expanded', 'false');
        await press(burger);
        await expect(burger).toHaveAttribute('aria-expanded', 'true');
        await expect(links).toHaveClass(/active/);
        await expectNoSidewaysScroll(page, 'hospitals with the menu open');
      } else {
        await expect(burger).toBeHidden();
        const contact = links.getByRole('link', { name: 'Contact' });
        await expectUsable(page, contact, 'Contact link');
        await press(contact);
        await expect(page).toHaveURL(/pages\/contact\.html$/);
        await expectNoSidewaysScroll(page, 'contact');
      }
    });

    // Real bug found while writing these tests: with the menu open on a small screen both .nav-links lists get .active and
    // are fixed over the same area, so the Login / Sign Up list sits on top of Home, About Us, Contact and Services, and the
    // 170px logo covers the top of the panel. A tap on Contact lands on the other list. Remove .fixme once it is fixed.
    if (vp.menu) {
      test.fixme('a link in the open mobile menu can be tapped', async ({ page }) => {
        await page.goto('/pages/hospitals.html');
        await press(page.getByRole('button', { name: 'Mobile menu' }));
        const contact = page.locator('#main-nav-links').getByRole('link', { name: 'Contact' });
        await expectUsable(page, contact, 'Contact link');
        await press(contact);
        await expect(page).toHaveURL(/pages\/contact\.html$/);
      });
    }

    test('emergency access: SOS and the 112 call link are reachable and SOS opens without sign-in or location', async ({ page }) => {
      await page.goto('/pages/ambulances.html');
      const trigger = page.locator('#relief-emergency-sos-trigger');
      await expectUsable(page, trigger, 'SOS button');
      await expectUsable(page, page.locator('a.relief-sos-quick-dial[href="tel:112"]'), '112 call link');
      await expectNoSidewaysScroll(page, 'ambulances');

      await press(trigger);
      const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
      await expect(dialog).toBeVisible();
      // The dialog fits on the screen and its buttons can be reached on it.
      const box = await dialog.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
      await expectUsable(page, dialog.getByRole('button', { name: 'Cancel Emergency SOS' }), 'Cancel button');
      await expectUsable(page, dialog.getByRole('button', { name: 'Confirm Emergency SOS Request' }), 'Confirm button');

      // One tap on Cancel closes it and nothing was dialled, texted or opened.
      await press(dialog.getByRole('button', { name: 'Cancel Emergency SOS' }));
      await expect(dialog).toBeHidden();
      const guard = await relief(page);
      expect(guard.opened).toEqual([]);
      expect(guard.links).toEqual([]);
    });

    test('directory search: find a facility by area, filter, and reach its call and directions buttons', async ({ page }) => {
      await page.goto('/pages/hospitals.html');
      const cards = page.locator('.hospital-card');
      await expect(cards).toHaveCount(FACILITIES.length);
      await expectNoSidewaysScroll(page, 'hospitals');

      const search = page.getByLabel('Search by name, area or service');
      await expectUsable(page, search, 'search box');
      await search.fill('Bankura');
      const expected = FACILITIES.filter((f) => `${f.name} ${f.district} ${(f.services || []).join(' ')}`.toLowerCase().includes('bankura')).length;
      expect(expected).toBeGreaterThan(0);
      await expect(cards).toHaveCount(expected);
      await expectNoSidewaysScroll(page, 'hospitals after search');

      const card = cards.first();
      await expectUsable(page, card.locator('a[href^="tel:"]').first(), 'call link');
      await expectUsable(page, card.getByRole('button', { name: /directions/i }).first(), 'Directions button');

      await search.fill('zzzz-not-a-hospital');
      await expect(page.locator('.no-results')).toContainText('No facilities found matching your criteria');
      await expectNoSidewaysScroll(page, 'hospitals empty state');
    });

    test('appointment request: choose a doctor, pick a time, give details, submit', async ({ page }) => {
      page.on('dialog', (dialog) => dialog.accept()); // doctors.js shows an alert() before it goes to the form
      await page.clock.setFixedTime(new Date('2026-10-14T10:00:00'));
      await page.goto('/pages/doctors.html');
      await expect(page.locator('.btn-book').first()).toBeVisible();
      await expectNoSidewaysScroll(page, 'doctors');
      const doctorName = (await page.locator('.doctor-card .doctor-name').first().innerText()).trim();
      await press(page.locator('.btn-book').first());
      await expect(page).toHaveURL(/pages\/appointments\.html$/);

      await expect(page.locator('.doctor-summary')).toContainText(doctorName);
      await expectNoSidewaysScroll(page, 'appointments step 1');
      await press(page.locator('.form-step[data-step="1"] .btn-next'));

      // Step 2: an empty step is refused with a message, then a date and a window go through.
      const step2Next = page.locator('.form-step[data-step="2"] .btn-next');
      await expectUsable(page, step2Next, 'Continue button (step 2)');
      await press(step2Next);
      await expect(page.locator('#appointment-error-summary')).toBeVisible();
      await page.getByLabel('Preferred date').fill('2026-10-16');
      await press(page.getByLabel('Morning (8 am to 12 pm)'));
      await expectNoSidewaysScroll(page, 'appointments step 2');
      await press(step2Next);

      // Step 3: details and consent, then submit.
      await expect(page.locator('.appointment-summary')).toContainText(doctorName);
      await page.getByLabel('Full Name').fill('Asha Rao');
      await page.getByLabel('Email').fill('asha@example.com');
      await page.getByLabel('Phone Number').fill('+91 98765 43210');
      await press(page.getByLabel(/I agree|consent/i));
      await expectNoSidewaysScroll(page, 'appointments step 3');
      const submit = page.getByRole('button', { name: 'Submit Request' });
      await expectUsable(page, submit, 'Submit Request button');
      await press(submit);

      const done = page.locator('#request-success');
      await expect(done).toContainText('Request submitted, not yet confirmed');
      await expect(done).toContainText('not a confirmed appointment');
      await expect(page.locator('#my-requests-list')).toContainText(doctorName);
      await expectNoSidewaysScroll(page, 'appointments after submit');
    });

    test('dashboard: a reminder can be added and the assistant answers', async ({ page }) => {
      await page.goto('/pages/dashboard.html');
      await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
      await expectNoSidewaysScroll(page, 'dashboard');

      await page.getByLabel('Medicine or label').fill('Vitamin D');
      await page.getByLabel('Time (every day)').fill('08:00');
      const save = page.getByRole('button', { name: 'Save Reminder' });
      await expectUsable(page, save, 'Save Reminder button');
      await press(save);
      await expect(page.locator('.reminder-item', { hasText: 'Vitamin D' })).toContainText('Daily at 08:00');
      await expect(page.locator('#kpi-reminders')).toHaveText('1');

      await page.getByLabel('Ask Relief Assistant about symptoms, hospitals, medicines').fill('Find nearby hospitals');
      const send = page.getByRole('button', { name: 'Send' });
      await expectUsable(page, send, 'Send button');
      await press(send);
      await expect(page.locator('#chatbot-messages')).toContainText('The Hospitals page lists facilities');
      await expectNoSidewaysScroll(page, 'dashboard after use');
    });
  });
}

// Real bug found while writing these tests: at 360px, a common Android width, the hospital and doctor cards are 10px wider than
// the screen (and the language switcher 4px), so both directory pages scroll sideways. Remove .fixme once it is fixed.
test.describe('phone 360x640', () => {
  test.use({ viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true });

  for (const route of ['/pages/hospitals.html', '/pages/doctors.html']) {
    test.fixme('no sideways scrolling on ' + route, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator('.hospital-card, .doctor-card').first()).toBeVisible();
      await expectNoSidewaysScroll(page, route);
    });
  }
});
