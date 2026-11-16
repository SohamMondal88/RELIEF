// Journey: the shared email check (assets/js/validators.js, Issue #197) on the pages that use it.
// The browser's own type="email" check lets values like "..a@b.co" through, so these only pass when our check runs.
const { test, expect } = require('./fixtures');

const BAD_EMAIL = '..a@b.co';

test.describe('shared email validation', () => {
  test('contact: a malformed address is refused, a good one with spaces around it goes through', async ({ page }) => {
    await page.clock.install();
    await page.goto('/pages/contact.html');
    await page.clock.fastForward(2500); // the form guard treats a submit in the first 1.5 s as a bot
    await page.getByLabel('Full Name*').fill('Asha Rao');
    await page.getByLabel('Subject').selectOption('volunteer');
    await page.getByLabel('Your Message*').fill('I can help on weekends with first aid.');
    await page.locator('#consent').check();

    await page.getByLabel('Email Address*').fill(BAD_EMAIL);
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.locator('#email + .error-message')).toHaveText('Please enter a valid email address');
    await expect(page.locator('.contact-send-failure')).toHaveCount(0);   // nothing was sent
    await expect(page.getByLabel('Your Message*')).toHaveValue('I can help on weekends with first aid.');

    await page.getByLabel('Email Address*').fill('  asha@example.com  ');
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.locator('#email + .error-message')).toHaveText('');
    // This repo has no backend, so a message that passed validation is reported as not sent (see contact.spec.js)
    await expect(page.locator('.contact-send-failure')).toContainText('Your message was not sent');
  });

  test('login: a malformed address gets the inline message, a good one clears it', async ({ page }) => {
    await page.goto('/pages/login.html');
    await page.locator('#login-email').fill(BAD_EMAIL);
    await page.locator('#login-password').fill('secret123');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator('#login-email + .error-message')).toHaveText('Please enter a valid email address');

    await page.locator('#login-email').fill('test.person@example.com');
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.locator('#login-email + .error-message')).toHaveText('');
  });
});
