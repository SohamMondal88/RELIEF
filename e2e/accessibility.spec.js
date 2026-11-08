// Journey: keyboard and screen reader behaviour of the core flows (Issue #51).
// Uses axe-core for the automated rules and plain Playwright for the things axe cannot see
// (where focus goes, what is announced). See docs/ACCESSIBILITY.md for what was checked by hand.
const { test, expect } = require('./fixtures');
const { showTour, signUp } = require('./helpers');

const AXE_SOURCE = require.resolve('axe-core/axe.min.js');

// The pages the audit covers. The home page has its own splash screen, see the wait below.
const PAGES = [
  '/index.html',
  '/pages/login.html',
  '/pages/signup.html',
  '/pages/hospitals.html',
  '/pages/pharmacies.html',
  '/pages/doctors.html',
  '/pages/ambulances.html',
  '/pages/appointments.html',
  '/pages/symptoms.html',
  '/pages/firstaid.html',
  '/pages/dashboard.html',
  '/pages/subscription.html',
  '/pages/contact.html',
  '/pages/about.html',
  '/pages/blog.html',
  '/pages/cookie-policy.html',
  '/pages/privacy-policy.html',
  '/pages/terms-of-service.html'
];

async function runAxe(page) {
  await page.addScriptTag({ path: AXE_SOURCE });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n')[1])
    }));
  });
}

async function open(page, path) {
  await page.goto(path);
  if (path === '/index.html') {
    // The splash screen hides the page for 3 seconds.
    await expect(page.locator('.main-content')).toBeVisible({ timeout: 8000 });
  }
}

const focusInfo = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName.toLowerCase(), id: el.id, inMain: !!el.closest('main'), inDialog: !!el.closest('[role="dialog"]') };
  });

test.describe('automated checks (axe-core, WCAG 2.0/2.1 A and AA)', () => {
  // Two known script bugs that are not accessibility problems and are left alone here:
  // pharmacies and ambulances call Leaflet (L) although the fixture blocks the CDN, and assets/js/blog.js
  // adds a listener to a mobile menu button that the blog page does not have.
  test.use({ allowedPageErrors: [/^(L is not defined|Cannot read properties of null \(reading 'addEventListener'\))$/] });

  for (const path of PAGES) {
    test(`no violations on ${path}`, async ({ page }) => {
      await open(page, path);
      const violations = await runAxe(page);
      expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    });
  }
});

test.describe('skip link', () => {
  for (const path of ['/pages/login.html', '/pages/hospitals.html', '/pages/dashboard.html', '/pages/subscription.html']) {
    test(`moves focus into the main area on ${path}`, async ({ page }) => {
      await open(page, path);
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await skip.focus();
      await expect(skip).toBeInViewport();
      await page.keyboard.press('Enter');

      expect(await focusInfo(page)).toMatchObject({ tag: 'main', id: 'main-content' });
      // The next Tab starts inside the content, not back in the navigation.
      await page.keyboard.press('Tab');
      expect((await focusInfo(page)).inMain).toBe(true);
    });
  }
});

test.describe('first-visit tour dialog', () => {
  test('keeps Tab inside, leaves the page behind inert and returns focus on Escape', async ({ page }) => {
    await showTour(page);
    await page.goto('/index.html');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 8000 });
    await expect(dialog).toBeFocused();

    // More Tab presses than the dialog has controls: focus must never leave it.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect((await focusInfo(page)).inDialog, `Tab press ${i + 1}`).toBe(true);
    }
    // And backwards from the first control wraps to the last.
    await dialog.focus();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await focusInfo(page)).inDialog, `Shift+Tab press ${i + 1}`).toBe(true);
    }

    await expect(page.locator('.main-content')).toHaveAttribute('inert', '');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.main-content')).not.toHaveAttribute('inert', '');
    // It opened by itself, so focus goes to the page's main area rather than to <body>.
    expect(await focusInfo(page)).toMatchObject({ tag: 'main', id: 'main-content' });
  });

  test('step buttons are plain buttons and the current one is marked', async ({ page }) => {
    await showTour(page);
    await page.goto('/index.html');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Go to step 1' })).toHaveAttribute('aria-current', 'step');
    await page.getByRole('button', { name: 'Go to step 3' }).click();
    await expect(page.getByRole('button', { name: 'Go to step 3' })).toHaveAttribute('aria-current', 'step');
    await expect(page.getByRole('button', { name: 'Go to step 1' })).not.toHaveAttribute('aria-current', 'step');
  });
});

test.describe('login and signup messages', () => {
  test('a refused login is announced, marks the fields and puts focus on the password', async ({ page }) => {
    await page.goto('/pages/login.html');
    await page.locator('#login-email').fill('nobody@example.com');
    await page.locator('#login-password').fill('wrong-password');
    await page.getByRole('button', { name: 'Login' }).click();

    const message = page.locator('#form-message');
    await expect(message).toHaveAttribute('role', 'alert');
    await expect(message).toContainText('Invalid email or password');
    await expect(page.locator('#login-password')).toBeFocused();
    await expect(page.locator('#login-password')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#login-password')).toHaveAttribute('aria-describedby', 'form-message');

    // It stays until the person edits something (it used to vanish after 5 seconds).
    await page.waitForTimeout(5500);
    await expect(message).toBeVisible();
    await page.locator('#login-password').fill('x');
    await expect(message).toHaveCount(0);
    await expect(page.locator('#login-password')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('signup flags the field a message is about and moves focus to it', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await page.getByLabel('Full Name').fill('Asha Verma');
    await page.getByLabel('Email', { exact: true }).fill('asha.verma@example.com');
    await page.locator('#signup-password').fill('abcdef');
    await page.locator('#signup-confirm-password').fill('abcdeg');
    await page.locator('#terms').check();
    await page.getByRole('button', { name: 'Sign Up' }).click();

    await expect(page.locator('#form-message')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#signup-confirm-password')).toBeFocused();
    await expect(page.locator('#signup-confirm-password')).toHaveAttribute('aria-invalid', 'true');
  });

  test('the form fields tell the browser what they are for', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await expect(page.locator('#signup-name')).toHaveAttribute('autocomplete', 'name');
    await expect(page.locator('#signup-email')).toHaveAttribute('autocomplete', 'email');
    await expect(page.locator('#signup-password')).toHaveAttribute('autocomplete', 'new-password');
    await page.goto('/pages/login.html');
    await expect(page.locator('#login-password')).toHaveAttribute('autocomplete', 'current-password');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Login to Your Account');
  });

  test('a duplicate email on signup points at the email field', async ({ page }) => {
    await signUp(page, { email: 'dup@example.com' });
    await page.waitForURL('**/dashboard.html');
    await page.evaluate(() => window.ReliefSession.clearSessions());
    await signUp(page, { email: 'dup@example.com' });
    await expect(page.locator('#form-message')).toContainText('Email already in use');
    await expect(page.locator('#signup-email')).toBeFocused();
  });
});

test.describe('reminders', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
  });

  test('a refused save marks the wrong fields, and a good save clears them and announces the result', async ({ page }) => {
    await page.getByRole('button', { name: 'Save Reminder' }).click();
    // The error summary and field marks come from form-errors.js; with two things wrong focus is on the summary.
    await expect(page.locator('#reminder-error-summary')).toBeVisible();
    await expect(page.locator('#reminder-error-summary')).toBeFocused();
    await expect(page.locator('#medicine')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#time')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#instructions')).not.toHaveAttribute('aria-invalid', 'true');

    await page.locator('#medicine').fill('Iron');
    await page.locator('#time').fill('07:00');
    await page.getByRole('button', { name: 'Save Reminder' }).click();
    await expect(page.locator('#medicine')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#reminder-status')).toContainText('Iron reminder saved for 07:00');
  });

  test('actions say which medicine they are for, announce the result and keep focus in the list', async ({ page }) => {
    for (const [medicine, time] of [['Iron', '07:00'], ['Zinc', '08:00']]) {
      await page.locator('#medicine').fill(medicine);
      await page.locator('#time').fill(time);
      await page.getByRole('button', { name: 'Save Reminder' }).click();
    }

    const pauseIron = page.getByRole('button', { name: 'Pause: Iron' });
    await expect(pauseIron).toHaveText('Pause');
    await pauseIron.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#reminder-status')).toHaveText('Iron paused.');
    // The list was rebuilt; focus is on the same row's button, which now says Resume.
    const resumeIron = page.getByRole('button', { name: 'Resume: Iron' });
    await expect(resumeIron).toBeFocused();

    await page.getByRole('button', { name: 'Done: Iron' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#reminder-status')).toHaveText('Iron marked done.');
    await expect(page.getByRole('button', { name: 'Remove: Iron' })).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#reminder-status')).toHaveText('Iron removed.');
    // The row is gone, so focus goes to the list instead of falling to <body>.
    await expect(page.locator('#reminder-list')).toBeFocused();
  });
});

test.describe('Relief Assistant', () => {
  test('the conversation is a labelled log that can be scrolled from the keyboard', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    const log = page.getByRole('log', { name: 'Conversation with Relief Assistant' });
    await expect(log).toBeVisible();
    await log.focus();
    await expect(log).toBeFocused();
    await page.locator('#chatbot-input').fill('First aid tips');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(log).toContainText('First aid');
  });
});

test.describe('symptom checker steps', () => {
  test('moving between steps moves focus to the new step, and results take focus', async ({ page }) => {
    await page.goto('/pages/symptoms.html');
    await page.locator('#symptoms').fill('mild cough for two days');
    await page.locator('.form-step.active .btn-next').click();
    const step2 = page.getByRole('group', { name: 'Step 2 of 3: Additional Info' });
    await expect(step2).toBeFocused();
    await expect(page.locator('.checker-steps .step[aria-current="step"]')).toContainText('Additional Info');

    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(page.getByRole('group', { name: 'Step 1 of 3: Describe Symptoms' })).toBeFocused();

    await page.locator('.form-step.active .btn-next').click();
    await page.getByRole('button', { name: 'View Guidance' }).click();
    await expect(page.getByRole('region', { name: 'Your guidance results' })).toBeFocused();
  });
});

test.describe('keyboard focus is visible on form fields', () => {
  for (const [path, selector] of [
    ['/pages/login.html', '#login-email'],
    ['/pages/symptoms.html', '#symptoms'],
    ['/pages/contact.html', '#name']
  ]) {
    test(`${selector} on ${path} gets a solid outline when focused by keyboard`, async ({ page }) => {
      await page.goto(path);
      await page.locator(selector).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await expect(page.locator(selector)).toBeFocused();
      const ring = await page.locator(selector).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.style).not.toBe('none');
      expect(ring.width).toBeGreaterThanOrEqual(2);
    });
  }
});
