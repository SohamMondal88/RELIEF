// Journey: form errors, inline help and focus (Issue #112).
// Every test here drives the forms with the keyboard: submit with nothing or wrong values, see what is
// announced and where focus goes, correct the values and submit again. Typed values must survive.
// Forms covered: contact, login, signup, appointment request, medicine reminder, location box.
const { test, expect } = require('./fixtures');

const BACKEND = 'https://backend.mock.relief.test';

// The contact page calls its own backend from the browser, which the site's CSP refuses (see contact.spec.js).
// Only the one test that needs a confirmed send turns the policy off; nothing leaves the machine either way.
async function configureBackend(page) {
  await page.addInitScript((url) => { window.RELIEF_BACKEND_URL = url; }, BACKEND);
  await page.route(BACKEND + '/v1/contact-messages', (route) => route.fulfill({ status: 201, json: { status: 'received' } }));
}

// The form guard treats a submit within 1.5 seconds of the page loading as a bot, so move the clock on.
async function openContact(page) {
  await page.clock.install();
  await page.goto('/pages/contact.html');
  await page.clock.fastForward(2500);
}

const invalid = (locator) => expect(locator).toHaveAttribute('aria-invalid', 'true');
const valid = (locator) => expect(locator).not.toHaveAttribute('aria-invalid', 'true');

// The accessible description of a field (what a screen reader adds after its name).
const described = (page, selector) => page.locator(selector).evaluate((el) => {
  return (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
    .map((id) => { const node = document.getElementById(id); return node && !node.hidden ? node.textContent.trim() : ''; })
    .filter(Boolean).join(' ');
});

test.describe('contact form', () => {
  test('an empty submit lists every problem, links each field to its message and keeps typed text', async ({ page }) => {
    await openContact(page);
    await page.getByLabel('Subject').selectOption('donation');

    await page.getByRole('button', { name: 'Send Message' }).focus();
    await page.keyboard.press('Enter');

    // Several problems: focus goes to the alert summary, which links to each field.
    const summary = page.locator('#contact-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    await expect(summary).toHaveAttribute('role', 'alert');
    await expect(summary).toContainText('4 problems');
    await expect(summary.getByRole('link')).toHaveCount(4);

    for (const [id, text] of [['name', 'Please enter your name'], ['email', 'Please enter your email'], ['message', 'Please enter your message'], ['consent', 'You must agree to the privacy policy']]) {
      await invalid(page.locator('#' + id));
      await expect(page.locator('#' + id + '-error')).toHaveText(text);
      expect(await described(page, '#' + id)).toBe(text);
    }
    // The choice made before the failed submit is still there.
    await expect(page.getByLabel('Subject')).toHaveValue('donation');
  });

  test('a summary link moves focus to its field, and typing there clears just that message', async ({ page }) => {
    await openContact(page);
    await page.getByRole('button', { name: 'Send Message' }).focus();
    await page.keyboard.press('Enter');

    await page.locator('#contact-error-summary').getByRole('link', { name: 'Please enter your email' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#email')).toBeFocused();

    await page.keyboard.type('asha@example.com');
    await valid(page.locator('#email'));
    await expect(page.locator('#email-error')).toBeHidden();
    await expect(page.locator('#contact-error-summary')).toContainText('3 problems');
    await expect(page.locator('#contact-error-summary')).not.toContainText('Please enter your email');
    // The other fields still show theirs.
    await invalid(page.locator('#name'));
    await invalid(page.locator('#message'));
    await expect(page.locator('#email')).toHaveValue('asha@example.com');
  });

  test('one wrong value sends focus to that field, and the corrected form goes through with nothing lost', async ({ page }) => {
    await openContact(page);
    await page.locator('#name').fill('Asha Rao');
    await page.locator('#email').fill('asha@example');
    await page.locator('#message').fill('I can help on weekends with first aid.');
    await page.locator('#consent').check();
    // Leaving the email box already flagged it; clearing the page state shows the submit path on its own.
    await page.locator('#email').focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#email')).toBeFocused();
    await invalid(page.locator('#email'));
    await expect(page.locator('#email-error')).toContainText('valid email');
    expect(await described(page, '#email')).toContain('valid email');
    await expect(page.locator('#contact-error-summary')).toContainText('1 problem');
    // Everything else the person typed is untouched.
    await expect(page.locator('#name')).toHaveValue('Asha Rao');
    await expect(page.locator('#message')).toHaveValue('I can help on weekends with first aid.');
    await expect(page.locator('#consent')).toBeChecked();

    // Correct it from the keyboard and submit again. This site has no backend, so the honest answer is "not sent".
    await page.keyboard.press('Control+A');
    await page.keyboard.type('asha@example.com');
    await expect(page.locator('#contact-error-summary')).toBeHidden();
    await valid(page.locator('#email'));
    await page.keyboard.press('Enter');

    const failure = page.locator('.contact-send-failure');
    await expect(failure).toContainText('Your message was not sent');
    await expect(failure).toHaveAttribute('role', 'alert');
    await expect(failure).toBeFocused();
    await expect(page.locator('#message')).toHaveValue('I can help on weekends with first aid.');
    await expect(page.locator('#contact-error-summary')).toBeHidden();
  });

  test('a message that is too short is caught on leaving the box and again on submit', async ({ page }) => {
    await openContact(page);
    await page.locator('#message').focus();
    await page.keyboard.type('too short');
    await page.keyboard.press('Tab');
    await invalid(page.locator('#message'));
    await expect(page.locator('#message-error')).toContainText('at least 10 characters');
  });

  test.describe('with a confirmed send', () => {
    test.use({ bypassCSP: true });

    test('the confirmation takes focus, so a keyboard user is not dropped at the top of the page', async ({ page }) => {
      await configureBackend(page);
      await openContact(page);
      await page.locator('#name').fill('Asha Rao');
      await page.locator('#email').fill('asha@example.com');
      await page.locator('#message').fill('I can help on weekends with first aid.');
      await page.locator('#consent').check();
      await page.getByRole('button', { name: 'Send Message' }).focus();
      await page.keyboard.press('Enter');

      const done = page.locator('.form-success');
      await expect(done).toContainText('Message sent');
      await expect(done).toBeFocused();
    });
  });

  test('on a 375px phone the messages are visible and showing them adds no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openContact(page);
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const before = await sideways();
    await page.getByRole('button', { name: 'Send Message' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('#contact-error-summary')).toBeInViewport();
    await expect(page.locator('#name-error')).toBeVisible();
    await expect(page.locator('#consent-error')).toBeVisible();
    // The page already scrolls 2px sideways before any error is shown (the map section); errors must not add to it.
    expect(await sideways()).toBeLessThanOrEqual(before);
  });
});

test.describe('login', () => {
  test('empty, wrong, then corrected: messages, focus and kept values at each step', async ({ page }) => {
    await page.goto('/pages/login.html');

    // Nothing typed: two problems, focus on the summary.
    await page.locator('#login-email').focus();
    await page.keyboard.press('Enter');
    const summary = page.locator('#login-error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('2 problems');
    await expect(page.locator('#login-email-error')).toHaveText('Please enter your email address.');
    await expect(page.locator('#login-password-error')).toHaveText('Please enter your password.');
    await invalid(page.locator('#login-email'));
    await invalid(page.locator('#login-password'));

    // A malformed email with a password: one problem, focus on the email, the password is still typed.
    await page.locator('#login-email').focus();
    await page.keyboard.type('nobody');
    await valid(page.locator('#login-email'));
    await page.keyboard.press('Tab');
    await page.keyboard.type('secret123');
    await page.keyboard.press('Enter');
    await expect(page.locator('#login-email')).toBeFocused();
    await expect(page.locator('#login-email-error')).toContainText('valid email');
    expect(await described(page, '#login-email')).toContain('valid email');
    await expect(page.locator('#login-password')).toHaveValue('secret123');
    await valid(page.locator('#login-password'));

    // Corrected email: it passes our checks and the server answer (no such account) is announced next.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('nobody@example.com');
    await expect(summary).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(page.locator('#form-message')).toContainText('Invalid email or password');
    await expect(page.locator('#form-message')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#login-password')).toBeFocused();
    await expect(page.locator('#login-email')).toHaveValue('nobody@example.com');
    await expect(page.locator('#login-password')).toHaveValue('secret123');
  });
});

test.describe('signup', () => {
  test('every missing answer is listed, the checkbox works from the keyboard, and the corrected form creates the account', async ({ page }) => {
    await page.goto('/pages/signup.html');
    await page.locator('#signup-name').focus();
    await page.keyboard.press('Enter');

    const summary = page.locator('#signup-error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('5 problems');
    for (const id of ['signup-name', 'signup-email', 'signup-password', 'signup-confirm-password', 'terms']) {
      await invalid(page.locator('#' + id));
      expect(await described(page, '#' + id)).not.toBe('');
    }

    // Fill the form from the keyboard, getting two things wrong on purpose.
    await page.locator('#signup-name').focus();
    await page.keyboard.type('Asha Verma');
    await page.keyboard.press('Tab');
    await page.keyboard.type('asha.verma@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('abc');
    await page.keyboard.press('Tab');
    await page.keyboard.type('abc');
    await page.keyboard.press('Tab');
    await expect(page.locator('#terms')).toBeFocused();
    await page.keyboard.press('Space');
    await valid(page.locator('#terms'));
    await expect(page.locator('#terms-error')).toBeHidden();
    await page.keyboard.press('Enter');

    // Only the password is wrong now. Focus is on it, and nothing typed was lost.
    await expect(page.locator('#signup-password')).toBeFocused();
    await expect(page.locator('#signup-password-error')).toContainText('at least 6 characters');
    await expect(summary).toContainText('1 problem');
    await expect(page.locator('#signup-name')).toHaveValue('Asha Verma');
    await expect(page.locator('#signup-email')).toHaveValue('asha.verma@example.com');
    await expect(page.locator('#terms')).toBeChecked();

    // Fix the password and its confirmation.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('abcdef');
    await valid(page.locator('#signup-password'));
    await page.locator('#signup-confirm-password').fill('abcdeg');
    await page.keyboard.press('Enter');
    await expect(page.locator('#signup-confirm-password')).toBeFocused();
    await expect(page.locator('#signup-confirm-password-error')).toHaveText('Passwords do not match.');

    await page.keyboard.press('Control+A');
    await page.keyboard.type('abcdef');
    await page.keyboard.press('Enter');
    await expect(page.locator('.alert-success')).toContainText('Account created');
    await page.waitForURL('**/pages/dashboard.html');
  });
});

test.describe('appointment request', () => {
  const DOCTOR = { id: 'doc-1', name: 'Dr. Example', specialty: 'General medicine', location: 'Kolkata' };

  function dateInDays(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  test('each step explains what is missing, and corrected values are submitted without retyping', async ({ page }) => {
    await page.addInitScript((doctor) => { localStorage.setItem('selectedDoctor', JSON.stringify(doctor)); }, DOCTOR);
    await page.goto('/pages/appointments.html');

    await page.locator('.form-step[data-step="1"] .btn-next').focus();
    await page.keyboard.press('Enter');

    // Step 2 with nothing chosen: two problems, focus on the summary.
    const summary = page.locator('#appointment-error-summary');
    await page.locator('.form-step[data-step="2"] .btn-next').focus();
    await page.keyboard.press('Enter');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('2 problems');
    await invalid(page.locator('#preferred-date'));
    await invalid(page.locator('#time-window-group'));
    await expect(page.locator('#preferred-date-error')).toBeVisible();
    await expect(page.locator('#time-window-error')).toBeVisible();

    // Choosing a window with the keyboard clears its message; the date still shows its own.
    await page.locator('#window-morning').focus();
    await page.keyboard.press('Space');
    await valid(page.locator('#time-window-group'));
    await expect(page.locator('#time-window-error')).toBeHidden();
    await expect(summary).toContainText('1 problem');
    await invalid(page.locator('#preferred-date'));

    // One problem left: the date. Continue sends focus straight to it.
    await page.locator('.form-step[data-step="2"] .btn-next').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#preferred-date')).toBeFocused();
    await page.locator('#preferred-date').fill(dateInDays(3));
    await valid(page.locator('#preferred-date'));
    await expect(summary).toBeHidden();
    await page.locator('.form-step[data-step="2"] .btn-next').focus();
    await page.keyboard.press('Enter');

    // Step 3: nothing typed, four problems.
    await expect(page.locator('#patient-name')).toBeVisible();
    await page.getByRole('button', { name: 'Submit Request' }).focus();
    await page.keyboard.press('Enter');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('4 problems');

    // Fill it in with a wrong email, submit from the keyboard: only the email is flagged and focused.
    await page.locator('#patient-name').fill('Asha Rao');
    await page.locator('#patient-email').fill('asha@example');
    await page.locator('#patient-phone').fill('+91 98765 43210');
    await page.locator('#patient-consent').check();
    await page.locator('#patient-email').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#patient-email')).toBeFocused();
    await invalid(page.locator('#patient-email'));
    await expect(page.locator('#patient-email-error')).toContainText('valid email');
    expect(await described(page, '#patient-email')).toContain('valid email');
    await expect(page.locator('#patient-name')).toHaveValue('Asha Rao');
    await expect(page.locator('#patient-phone')).toHaveValue('+91 98765 43210');

    await page.keyboard.press('Control+A');
    await page.keyboard.type('asha@example.com');
    await valid(page.locator('#patient-email'));
    await page.keyboard.press('Enter');
    await expect(page.locator('#request-success')).toContainText('Request submitted, not yet confirmed');
    await expect(page.locator('#request-success h3')).toBeFocused();
  });
});

test.describe('medicine reminder', () => {
  test('invalid then corrected from the keyboard: messages follow each edit and the saved reminder keeps its values', async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');

    await page.locator('#instructions').fill('after breakfast');
    await page.getByRole('button', { name: 'Save Reminder' }).focus();
    await page.keyboard.press('Enter');

    const summary = page.locator('#reminder-error-summary');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('2 problems');
    await expect(page.locator('#instructions')).toHaveValue('after breakfast');
    expect(await described(page, '#medicine')).not.toBe('');

    // Typing the name clears only its message.
    await page.locator('#medicine').focus();
    await page.keyboard.type('Iron');
    await valid(page.locator('#medicine'));
    await expect(page.locator('#medicine-error')).toBeHidden();
    await expect(summary).toContainText('1 problem');
    await invalid(page.locator('#time'));

    // The last problem: submitting focuses its field, not the summary.
    await page.getByRole('button', { name: 'Save Reminder' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#time')).toBeFocused();
    await page.locator('#time').fill('07:00');
    await expect(summary).toBeHidden();
    await page.locator('#time').press('Enter');
    await expect(page.locator('#reminder-status')).toContainText('Iron reminder saved for 07:00');
  });
});

test.describe('location box', () => {
  test('a refused place is marked invalid with its message, keeps the text, and clears when edited', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const input = page.locator('#location-input');
    await input.focus();
    await page.keyboard.type('ab');
    await page.keyboard.press('Enter');

    await expect(page.locator('#location-error')).not.toBeEmpty();
    await expect(input).toBeFocused();
    await invalid(input);
    expect(await described(page, '#location-input')).toBe(await page.locator('#location-error').innerText());
    await expect(page.locator('#location-error')).toHaveAttribute('role', 'alert');
    await expect(input).toHaveValue('ab');

    await page.keyboard.type('c');
    await valid(input);
    await expect(page.locator('#location-error')).toBeEmpty();

    // A town the page knows works from the keyboard and clears the box.
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Kolkata');
    await page.keyboard.press('Enter');
    await expect(page.locator('#location-current')).toContainText('Using your chosen location: Kolkata');
    await valid(input);
  });

  test('a failed GPS lookup explains itself without calling the typed text wrong', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await page.locator('#location-input').fill('Kolk');
    await page.getByRole('button', { name: 'Use my current location' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#location-error')).toContainText('Location permission was denied');
    await expect(page.locator('#location-input')).toBeFocused();
    await valid(page.locator('#location-input'));
    await expect(page.locator('#location-input')).toHaveValue('Kolk');
  });
});

// axe on the pages in the state a person actually meets them in after a failed submit. The accessibility spec
// only scans pages as they load, where every message is still hidden.
test.describe('axe-core with the errors showing', () => {
  // axe is injected as inline script, which the site's own policy blocks. Off for this block only (see accessibility.spec.js).
  test.use({ bypassCSP: true });

  async function violations(page) {
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    return page.evaluate(async () => {
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
      return result.violations.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
    });
  }

  test('contact, login and signup after an empty submit', async ({ page }) => {
    await openContact(page);
    await page.getByRole('button', { name: 'Send Message' }).click();
    await expect(page.locator('#contact-error-summary')).toBeVisible();
    expect(await violations(page)).toEqual([]);

    for (const [path, button, summary] of [['/pages/login.html', 'Login', '#login-error-summary'], ['/pages/signup.html', 'Sign Up', '#signup-error-summary']]) {
      await page.goto(path);
      await page.getByRole('button', { name: button }).click();
      await expect(page.locator(summary)).toBeVisible();
      expect(await violations(page), path).toEqual([]);
    }
  });

  test('the location box after a refused place', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    await page.locator('#location-input').fill('ab');
    // Enter, not a click: a click leaves the mouse over the button, and its hover colour is a separate, existing contrast finding.
    await page.locator('#location-input').press('Enter');
    await expect(page.locator('#location-error')).not.toBeEmpty();
    expect(await violations(page)).toEqual([]);
  });
});
