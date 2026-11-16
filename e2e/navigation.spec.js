// Journey: landing page, primary navigation, responsive menu and the Relief Assistant on the dashboard.
const { test, expect } = require('./fixtures');
const { openHome } = require('./helpers');

// (Login and Ambulances only exist in the navbar; names like About Us repeat in the footer.)
// Links the browser itself puts in the accessibility tree, asked over the DevTools protocol. Playwright's
// own getByRole does not look at `inert`, so it cannot tell a hidden drawer from an open one.
async function exposedLinkNames(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    return nodes.filter((n) => !n.ignored && n.role && n.role.value === 'link').map((n) => n.name && n.name.value);
  } finally {
    await cdp.detach();
  }
}

test.describe('landing page and primary navigation', () => {
  test('home page shows the hero, the skip link and the main navigation', async ({ page }) => {
    await openHome(page);
    await expect(page).toHaveTitle(/Relief/i);
    await expect(page.getByRole('heading', { level: 1, name: 'Your Health, Our Priority' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeAttached();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Home', 'About Us', 'Contact', 'Login', 'Sign Up']) {
      await expect(nav.getByRole('link', { name })).toBeVisible();
    }
  });

  test('About Us and Contact links work', async ({ page }) => {
    await openHome(page);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'About Us' }).click();
    await expect(page).toHaveURL(/pages\/about\.html$/);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Contact' }).click();
    await expect(page).toHaveURL(/pages\/contact\.html$/);
  });

  test.describe('Services menu', () => {
    async function openServices(page) {
      await openHome(page);
      await page.locator('.dropdown-toggle').hover();
      await page.getByRole('link', { name: 'Hospitals', exact: true }).first().click();
      await expect(page).toHaveURL(/pages\/hospitals\.html$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find Hospitals Near You');
    }

    test('leads to the hospitals page on a wide screen', async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 900 });
      await openServices(page);
    });

    // Real bug found while writing these tests: at 1280px the logo image sits on top of the Services link
    // (logo spans x 555 to 725, the link x 548 to 669), so the mouse cannot reach the menu.
    test.fixme('leads to the hospitals page at 1280px', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openServices(page);
    });
  });

  test('hero buttons open the symptom checker and the doctors page', async ({ page }) => {
    await openHome(page);
    await page.getByRole('link', { name: 'Check Symptoms' }).click();
    await expect(page).toHaveURL(/pages\/symptoms\.html$/);
    await page.goBack();
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    await page.getByRole('link', { name: 'Find a doctor near you' }).click();
    await expect(page).toHaveURL(/pages\/doctors\.html$/);
  });
});

test.describe('responsive navigation', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('hamburger opens and closes the menu, Escape closes it and returns focus', async ({ page }) => {
    await openHome(page);
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    const links = page.locator('#main-nav-links');

    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(links).not.toHaveClass(/active/);

    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(links).toHaveClass(/active/);
    await expect(links.getByRole('link', { name: 'About Us' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(links).not.toHaveClass(/active/);
    await expect(burger).toBeFocused();

    await burger.click();
    await expect(links).toHaveClass(/active/);
    await burger.click();
    await expect(links).not.toHaveClass(/active/);
  });

  test('a closed drawer is out of the Tab order and the accessibility tree, an open one is in it', async ({ page }) => {
    await openHome(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(page.locator('#main-nav-links')).toHaveAttribute('inert', '');
    expect(await exposedLinkNames(page)).not.toContain('Login');
    expect(await exposedLinkNames(page)).not.toContain('Ambulances');

    // Walk the first ten Tab stops from the top of the page: none of them may be a link in the off-screen drawer.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement.closest('.nav-links'))).toBe(false);
    }

    const burger = page.getByRole('button', { name: 'Mobile menu' });
    await burger.click();
    await expect(page.locator('#main-nav-links')).not.toHaveAttribute('inert', '');
    expect(await exposedLinkNames(page)).toEqual(expect.arrayContaining(['Login', 'Ambulances']));
    await nav.getByRole('link', { name: 'About Us' }).focus();
    await expect(nav.getByRole('link', { name: 'About Us' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator('#main-nav-links')).toHaveAttribute('inert', '');
    expect(await exposedLinkNames(page)).not.toContain('Login');
    expect(await exposedLinkNames(page)).not.toContain('Ambulances');
  });

  test('an in-page link outside the menu closes it and the drawer is inert again', async ({ page }) => {
    await page.goto('/pages/about.html');
    const burger = page.locator('.hamburger');
    const lists = page.locator('.nav-links');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(lists.first()).not.toHaveAttribute('inert', '');

    // "Explore Our Journey" is a link in the page, not in the drawer. The drawer can cover it, so click it from the script.
    await page.locator('a[href="#our-story"]').evaluate((el) => el.click());
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(burger).not.toHaveClass(/active/);
    for (let i = 0; i < await lists.count(); i++) {
      await expect(lists.nth(i)).not.toHaveClass(/active/);
      await expect(lists.nth(i)).toHaveAttribute('inert', '');
    }
    expect(await exposedLinkNames(page)).not.toContain('Login');
  });

  test('going to a desktop width closes the open menu and gives the navbar back', async ({ page }) => {
    await openHome(page);
    const burger = page.locator('.hamburger');
    const links = page.locator('#main-nav-links');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');

    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(burger).not.toHaveClass(/active/);
    await expect(links).not.toHaveClass(/active/);
    await expect(links).not.toHaveAttribute('inert', '');
    await expect(burger).toBeHidden();
    await expect(links.getByRole('link', { name: 'About Us' })).toBeVisible();
    expect(await exposedLinkNames(page)).toContain('Login');

    // Back to a phone: the drawer starts closed and out of reach, and still opens.
    await page.setViewportSize({ width: 375, height: 800 });
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(links).toHaveAttribute('inert', '');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(links).toHaveClass(/active/);
  });

  test('resizing within phone widths keeps the menu open', async ({ page }) => {
    await openHome(page);
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    await burger.click();
    await page.setViewportSize({ width: 420, height: 800 });
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#main-nav-links')).toHaveClass(/active/);
  });

  test('choosing a link closes the menu, opening Services does not', async ({ page }) => {
    await openHome(page);
    // Stop the browser from leaving the page, so the state after the click can be read.
    await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault()));
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    const links = page.locator('#main-nav-links');

    await burger.click();
    await links.locator('.dropdown-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(links.locator('.dropdown')).toHaveClass(/active/);
    await expect(burger).toHaveAttribute('aria-expanded', 'true');

    await links.getByRole('link', { name: 'About Us' }).focus();
    await page.keyboard.press('Enter');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(links).not.toHaveClass(/active/);
    await expect(links.locator('.dropdown')).not.toHaveClass(/active/);
    await expect(links).toHaveAttribute('inert', '');
  });

  // These two pages used to carry a second toggle of their own next to the one in main.js.
  for (const url of ['/pages/about.html', '/pages/ambulances.html']) {
    test(`one click opens and one click closes the menu on ${url}`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
      const burger = page.locator('.hamburger');
      const links = page.locator('#main-nav-links');
      await expect(links).toHaveAttribute('inert', '');
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
      await expect(links).toHaveClass(/active/);
      await expect(links).not.toHaveAttribute('inert', '');
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await expect(links).not.toHaveClass(/active/);
    });
  }

  // Headless Chromium does not keep pages in the back/forward cache, so this sends the event the browser
  // sends when it restores one.
  test('a page restored from the back/forward cache comes back with the menu closed', async ({ page }) => {
    await openHome(page);
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#main-nav-links')).not.toHaveClass(/active/);
    await expect(page.locator('#main-nav-links')).toHaveAttribute('inert', '');
  });

  test('page scrolling is not locked while the menu is open or after it closes', async ({ page }) => {
    await openHome(page);
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    const overflow = () => page.evaluate(() => [getComputedStyle(document.body).overflowY, getComputedStyle(document.documentElement).overflowY]);
    const scrollDown = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(200, 400);
      await page.mouse.wheel(0, 300);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    };

    await burger.click();
    expect((await overflow()).join()).not.toMatch(/hidden|clip/);
    await scrollDown();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.keyboard.press('Escape');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    expect((await overflow()).join()).not.toMatch(/hidden|clip/);
    await scrollDown();
  });

  // Real bug found while writing these tests: at 375px the language switcher (.relief-lang-switch) sticks
  // out 2px past the viewport, so the page scrolls sideways. Remove .fixme once it is fixed.
  test.fixme('no horizontal scrolling on the home page at phone width', async ({ page }) => {
    await openHome(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('responsive navigation on a touch screen', () => {
  test.use({ viewport: { width: 375, height: 800 }, hasTouch: true });

  test('tapping the hamburger opens the menu and tapping the page above it closes it', async ({ page }) => {
    await openHome(page);
    const burger = page.getByRole('button', { name: 'Mobile menu' });
    await burger.tap();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#main-nav-links')).toHaveClass(/active/);

    // The drawer starts under the top bar, so a tap on the quote banner is outside it.
    await page.touchscreen.tap(180, 30);
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#main-nav-links')).not.toHaveClass(/active/);

    await burger.tap();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    await burger.tap();
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
  });
});

test.describe('Relief Assistant (dashboard)', () => {
  // The assistant is a card on the dashboard, not a pop-up launcher, so there is no open/close
  // control to test. These cover what exists: greeting, routing, urgent escalation, clear.
  test('greets, routes a navigation question and clears the chat', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    const chat = page.locator('#chatbot-messages');
    await expect(chat).toContainText('I can’t give medical advice');

    await page.getByLabel('Ask Relief Assistant about symptoms, hospitals, medicines').fill('Find nearby hospitals');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(chat).toContainText('The Hospitals page lists facilities');
    await expect(chat.getByRole('link', { name: 'Hospitals' })).toHaveAttribute('href', './hospitals.html');

    await page.getByRole('button', { name: 'Clear chat' }).click();
    await expect(chat).not.toContainText('Find nearby hospitals');
    await expect(chat.locator('.chat-bubble')).toHaveCount(1);
  });

  test('an urgent message is escalated to emergency services, not answered as chat', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await page.getByLabel('Ask Relief Assistant about symptoms, hospitals, medicines').fill('I have severe chest pain');
    await page.getByRole('button', { name: 'Send' }).click();
    const urgent = page.locator('.chat-bubble.urgent');
    await expect(urgent).toHaveAttribute('role', 'alert');
    await expect(urgent).toContainText('call your local emergency services now');
    await expect(urgent.getByRole('link', { name: 'Emergency SOS' })).toBeVisible();
  });

  test('medical advice requests are declined and the chat is not stored', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    const before = await page.evaluate(() => Object.keys(localStorage).sort());
    await page.getByLabel('Ask Relief Assistant about symptoms, hospitals, medicines').fill('What dose of paracetamol should I take?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#chatbot-messages')).toContainText("I can't give medical advice");
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(before);
  });
});
