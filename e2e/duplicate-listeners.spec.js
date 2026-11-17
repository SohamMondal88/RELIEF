// Journey: one user action reaches one handler (issue #192).
const { test, expect } = require('./fixtures');

test.describe('forms', () => {
  test('signup shows one message for a short password, not a second copy under the field', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await page.getByLabel('Full Name').fill('Test Person');
    await page.getByLabel('Email', { exact: true }).fill('test.person@example.com');
    await page.locator('#signup-password').fill('abc');
    await page.locator('#signup-confirm-password').fill('abc');
    await page.locator('#terms').check();
    await page.getByRole('button', { name: 'Sign Up' }).click();

    await expect(page.locator('#form-message')).toHaveText(/Password must be at least 6 characters/);
    await expect(page.getByText('Password must be at least 6 characters')).toHaveCount(1);
    for (const text of await page.locator('#signup-form .error-message').allTextContents()) {
      expect(text).toBe('');
    }
  });

  test('login with a short password gets the sign in answer only, not a length rule from another script', async ({ page }) => {
    await page.goto('/pages/login.html');
    await page.getByLabel('Email', { exact: true }).fill('nobody@example.com');
    await page.locator('#login-password').fill('abc');
    await page.getByRole('button', { name: 'Login' }).first().click();

    await expect(page.locator('#form-message')).toBeVisible();
    await expect(page.getByText('Password must be at least 6 characters')).toHaveCount(0);
  });
});

test.describe('hamburger menu', () => {
  // The fixtures block the map library, so the map pages report "L is not defined", and blog.js does not guard its
  // missing mobile button (tracked on its own). Neither has anything to do with the menu, so they are allowed here
  // exactly as in accessibility.spec.js.
  test.use({
    viewport: { width: 375, height: 800 },
    allowedPageErrors: [/^(L is not defined|Cannot read properties of null \(reading 'addEventListener'\))$/]
  });

  const pages = ['about', 'ambulances', 'appointments', 'blog', 'contact', 'doctors', 'firstaid', 'hospitals', 'pharmacies', 'symptoms'];
  for (const name of pages) {
    test(`${name}: one click opens the menu and the next click closes it`, async ({ page }) => {
      await page.goto(`/pages/${name}.html`);
      const burger = page.locator('.hamburger');
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('.nav-links').first()).toHaveClass(/active/);
      await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('.nav-links').first()).not.toHaveClass(/active/);
    });
  }
});
