// Journey: ask for an appointment. The doctors page only starts a request, and the request form checks each
// field as the person leaves it, with the same rules as Continue and Submit.
// The clock is fixed so "today", "yesterday" and "the time window has ended" do not depend on when this runs.
const { test, expect } = require('./fixtures');

const NOW = new Date('2026-11-20T14:00:00+05:30'); // Friday, 2 pm in Kolkata: the morning window is over, the afternoon one is not
const DOCTOR = { id: 7, name: 'Dr. Test Person', specialty: 'General Practitioner', location: 'Test Clinic' };

const err = (page, id) => page.locator('#' + id);

async function openForm(page) {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((doctor) => {
    try { localStorage.setItem('selectedDoctor', JSON.stringify(doctor)); } catch (e) { /* storage blocked */ }
  }, DOCTOR);
  await page.goto('/pages/appointments.html');
  await expect(page.locator('.doctor-details h3')).toHaveText(DOCTOR.name);
}

// Continue from the step that is open now, and wait for the next one.
async function next(page) {
  const from = Number(await page.locator('.form-step.active').getAttribute('data-step'));
  await page.locator('.form-step.active .btn-next').click();
  await expect(page.locator('.form-step.active')).toHaveAttribute('data-step', String(from + 1));
}

// Gets to the last step with a valid date and window.
async function openDetailsStep(page) {
  await openForm(page);
  await next(page);
  await page.locator('#preferred-date').fill('2026-11-24');
  await page.locator('#window-evening').check();
  await next(page);
}

test.describe('doctors page: choosing a doctor starts a request', () => {
  test('the button says request, no pop-up pretends a booking happened, and the doctor is passed on', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.dismiss(); });
    await page.goto('/pages/doctors.html');
    const button = page.getByRole('button', { name: 'Request an appointment with Dr. Michael Chen' });
    await expect(button).toHaveText('Request Appointment');
    await expect(page.getByRole('button', { name: /^Book/ })).toHaveCount(0);

    await button.click();
    await expect(page).toHaveURL(/\/pages\/appointments\.html$/);
    await expect(page.locator('.doctor-details h3')).toHaveText('Dr. Michael Chen');
    expect(dialogs).toEqual([]);
  });
});

test.describe('request form: fields are checked as the person leaves them', () => {
  test('the date: empty on leaving, past, then fine; the typed value stays', async ({ page }) => {
    await openForm(page);
    await next(page);
    const date = page.locator('#preferred-date');

    await date.focus();
    await page.locator('#window-morning').focus();
    await expect(err(page, 'preferred-date-error')).toHaveText('Choose a preferred date.');
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    // One field is on screen, so no summary box interrupts the person.
    await expect(page.locator('#appointment-error-summary')).toBeHidden();

    await date.fill('2026-11-19');
    await expect(err(page, 'preferred-date-error')).toContainText('cannot be in the past');
    await expect(date).toHaveValue('2026-11-19');

    await date.fill('2026-11-20');
    await expect(err(page, 'preferred-date-error')).toBeHidden();
    await expect(date).not.toHaveAttribute('aria-invalid', 'true');

    await date.fill('2027-02-01');
    await expect(err(page, 'preferred-date-error')).toContainText('within the next 60 days');
  });

  test('a time window that has ended today is reported, and moving the date clears it', async ({ page }) => {
    await openForm(page);
    await next(page);
    await page.locator('#preferred-date').fill('2026-11-20');
    await page.locator('#window-morning').check();
    await expect(err(page, 'time-window-error')).toContainText('already ended today');
    await expect(page.locator('#time-window-group')).toHaveAttribute('aria-invalid', 'true');

    await page.locator('#preferred-date').fill('2026-11-21');
    await expect(err(page, 'time-window-error')).toBeHidden();

    await page.locator('#preferred-date').fill('2026-11-20');
    await expect(err(page, 'time-window-error')).toContainText('already ended today');
    await page.locator('#window-afternoon').check();
    await expect(err(page, 'time-window-error')).toBeHidden();
  });

  test('the time window is not nagged about before the person has chosen a date or window', async ({ page }) => {
    await openForm(page);
    await next(page);
    await page.locator('#preferred-date').fill('2026-11-24');
    await expect(err(page, 'time-window-error')).toBeHidden();
  });

  test('name, email and phone: a message when leaving a bad value, gone as soon as it is fixed', async ({ page }) => {
    await openDetailsStep(page);

    const name = page.locator('#patient-name');
    await name.focus();
    await page.locator('#patient-email').focus();
    await expect(err(page, 'patient-name-error')).toContainText('Enter your full name');
    await name.focus();
    await name.pressSequentially('R');
    await expect(err(page, 'patient-name-error')).toBeVisible();
    await name.pressSequentially('avi');
    await expect(err(page, 'patient-name-error')).toBeHidden();

    const email = page.locator('#patient-email');
    await email.fill('ravi@');
    await page.locator('#patient-phone').focus();
    await expect(err(page, 'patient-email-error')).toContainText('valid email');
    await expect(email).toHaveValue('ravi@');
    await email.fill('ravi@example.com');
    await expect(err(page, 'patient-email-error')).toBeHidden();

    const phone = page.locator('#patient-phone');
    await phone.fill('12345');
    await page.locator('#patient-notes').focus();
    await expect(err(page, 'patient-phone-error')).toContainText('valid phone number');
    await phone.fill('+91 98765 43210');
    await expect(err(page, 'patient-phone-error')).toBeHidden();
  });

  test('notes over the limit are reported and the text is kept; the consent box is checked when ticked and unticked', async ({ page }) => {
    await openDetailsStep(page);

    const notes = page.locator('#patient-notes');
    const long = 'a'.repeat(520);
    await notes.fill(long);
    await page.locator('#patient-consent').focus();
    await expect(err(page, 'patient-notes-error')).toContainText('500 characters or fewer');
    await expect(notes).toHaveValue(long);
    await notes.fill('short note');
    await expect(err(page, 'patient-notes-error')).toBeHidden();

    // Tabbing past an untouched box says nothing; unticking one that was ticked does.
    await page.locator('#patient-consent').focus();
    await page.locator('.btn-prev').last().focus();
    await expect(err(page, 'patient-consent-error')).toBeHidden();
    await page.locator('#patient-consent').check();
    await expect(err(page, 'patient-consent-error')).toBeHidden();
    await page.locator('#patient-consent').uncheck();
    await expect(err(page, 'patient-consent-error')).toContainText('agree to the privacy policy');
  });

  test('an open error summary follows the fields: a fixed field drops out of it and the others stay', async ({ page }) => {
    await openDetailsStep(page);

    await page.getByRole('button', { name: 'Submit Request' }).click();
    const summary = page.locator('#appointment-error-summary');
    await expect(summary).toBeVisible();
    await expect(summary.locator('li')).toHaveCount(4); // name, email, phone, consent

    await page.locator('#patient-name').fill('Ravi Kumar');
    await expect(summary.locator('li')).toHaveCount(3);
    await expect(summary).not.toContainText('full name');
    await expect(err(page, 'patient-email-error')).toBeVisible();

    await page.locator('#patient-email').fill('ravi@example.com');
    await page.locator('#patient-phone').fill('9876543210');
    await expect(summary.locator('li')).toHaveCount(1);
    await page.locator('#patient-consent').check();
    await expect(summary).toBeHidden();
  });

  test('the earliest and latest date move with the clock when the form is used again', async ({ page }) => {
    await openForm(page);
    const date = page.locator('#preferred-date');
    await expect(date).toHaveAttribute('min', '2026-11-20');
    await expect(date).toHaveAttribute('max', '2027-01-19');

    await page.clock.setFixedTime(new Date('2026-11-21T00:30:00+05:30'));
    await next(page);
    await date.focus();
    await expect(date).toHaveAttribute('min', '2026-11-21');
    await expect(date).toHaveAttribute('max', '2027-01-20');
  });

  test('a complete request is still accepted, and says it is not confirmed', async ({ page }) => {
    await openDetailsStep(page);
    await page.locator('#patient-name').fill('Ravi Kumar');
    await page.locator('#patient-email').fill('ravi@example.com');
    await page.locator('#patient-phone').fill('9876543210');
    await page.locator('#patient-consent').check();
    await page.getByRole('button', { name: 'Submit Request' }).click();
    await expect(page.locator('#request-success h3')).toHaveText('Request submitted, not yet confirmed');
    await expect(page.locator('#request-success')).toContainText('It is not a confirmed appointment yet');
  });
});
