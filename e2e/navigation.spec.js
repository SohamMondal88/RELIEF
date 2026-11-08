// Journey: landing page, primary navigation, responsive menu and the Relief Assistant on the dashboard.
const { test, expect } = require('./fixtures');
const { openHome } = require('./helpers');

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

  // Real bug found while writing these tests: at 375px the language switcher (.relief-lang-switch) sticks
  // out 2px past the viewport, so the page scrolls sideways. Remove .fixme once it is fixed.
  test.fixme('no horizontal scrolling on the home page at phone width', async ({ page }) => {
    await openHome(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
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
