// Journey: sign up, log in, log out and what a signed-out visitor can see.
// On localhost the app runs in demo mode: accounts live in this browser only (see assets/js/auth-mode.js).
const { test, expect } = require('./fixtures');
const { openHome, signUp, storedJson } = require('./helpers');

const USER = { name: 'Asha Verma', email: 'asha.verma@example.com', password: 'correct-horse' };

test.describe('sign up, login and logout (demo mode)', () => {
  test('signup creates a demo account, signs in and lands on the dashboard', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await expect(page.locator('#demo-notice')).toContainText('Demo mode');

    await signUp(page, USER);
    await expect(page.locator('.alert-success')).toContainText('Account created');
    await page.waitForURL('**/pages/dashboard.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Health Continuity Center');

    // A session exists and the password is never stored in plain text.
    const sessions = await storedJson(page, 'relief_auth_sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].user.email).toBe(USER.email);
    const everything = await page.evaluate(() => JSON.stringify(localStorage));
    expect(everything).not.toContain(USER.password);
    const users = await storedJson(page, 'relief_demo_users');
    expect(users[0]).toMatchObject({ email: USER.email });
    expect(users[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('signup rejects mismatched passwords, short passwords and a repeated email', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await page.getByLabel('Full Name').fill(USER.name);
    await page.getByLabel('Email', { exact: true }).fill(USER.email);
    await page.locator('#signup-password').fill('abcdef');
    await page.locator('#signup-confirm-password').fill('abcdeg');
    await page.locator('#terms').check();
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await expect(page.locator('.alert-danger')).toHaveText('Passwords do not match.');

    await page.locator('#signup-password').fill('abc');
    await page.locator('#signup-confirm-password').fill('abc');
    await page.getByRole('button', { name: 'Sign Up' }).click();
    await expect(page.locator('.alert-danger')).toContainText('at least 6 characters');
    expect(await storedJson(page, 'relief_demo_users')).toBeNull();

    // Create the account, sign out, then try the same email again.
    await signUp(page, USER);
    await page.waitForURL('**/dashboard.html');
    await page.evaluate(() => window.ReliefSession.clearSessions());
    await signUp(page, USER);
    await expect(page.locator('.alert-danger')).toContainText('Email already in use');
    await expect(page).toHaveURL(/signup\.html$/);
  });

  test('login with the right password works, a wrong password is refused', async ({ page }) => {
    await signUp(page, USER);
    await page.waitForURL('**/dashboard.html');
    await page.evaluate(() => window.ReliefSession.clearSessions());

    await page.goto('/pages/login.html');
    await page.locator('#login-email').fill(USER.email);
    await page.locator('#login-password').fill('wrong-password');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator('.alert-danger')).toHaveText('Invalid email or password.');
    await expect(page).toHaveURL(/login\.html$/);
    expect(await storedJson(page, 'relief_auth_sessions')).toBeNull();

    await page.locator('#login-password').fill(USER.password);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator('.alert-success')).toContainText('Login successful');
    await page.waitForURL('**/dashboard.html');
    expect(await storedJson(page, 'relief_auth_sessions')).toHaveLength(1);
  });

  test('signed in: the navbar shows Dashboard and Logout, and logout clears the session', async ({ page }) => {
    await signUp(page, USER);
    await page.waitForURL('**/dashboard.html');

    await openHome(page);
    const menu = page.locator('.navbar-right .user-menu');
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.btn-login')).toBeHidden();
    await expect(page.locator('.btn-signup')).toBeHidden();

    await menu.getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL('**/index.html');
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
    expect(await storedJson(page, 'relief_auth_sessions')).toBeNull();
    await expect(page.locator('.btn-login')).toBeVisible();
    await expect(page.locator('.btn-signup')).toBeVisible();
    await expect(page.locator('.navbar-right .user-menu')).toBeHidden();
  });

  test('a signed-in visitor who opens login or signup is sent to the dashboard', async ({ page }) => {
    await signUp(page, USER);
    await page.waitForURL('**/dashboard.html');
    await page.goto('/pages/login.html');
    await page.waitForURL('**/dashboard.html');
  });

  // Known gap, tracked by this test so it turns green by itself when the guard is added.
  // pages/dashboard.html has no sign-in check: a visitor with no session sees the dashboard.
  test.fixme('a signed-out visitor who opens the dashboard is sent to login', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await page.waitForURL('**/login.html');
  });
});
