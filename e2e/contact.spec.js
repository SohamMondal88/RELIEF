// Journey: contact form. It must only say "Message sent" when a backend confirmed the message (issue #74).
// This repo has no backend, so by default the page has to say the message was not sent.
// Nothing leaves the local site: the backend used in the "configured" tests is a fake host answered by page.route.
const { test, expect } = require('./fixtures');

const BACKEND = 'https://backend.mock.relief.test';
const ENDPOINT = BACKEND + '/v1/contact-messages';

async function configureBackend(page, handler) {
  await page.addInitScript((url) => { window.RELIEF_BACKEND_URL = url; }, BACKEND);
  const requests = [];
  await page.route(ENDPOINT, async (route) => {
    requests.push({ method: route.request().method(), body: route.request().postDataJSON() });
    await handler(route);
  });
  return requests;
}

// The form guard treats a submit within 1.5 seconds of the page loading as a bot, so move the clock on.
async function openForm(page) {
  await page.clock.install();
  await page.goto('/pages/contact.html');
  await page.clock.fastForward(2500);
  await page.getByLabel('Full Name*').fill('Asha Rao');
  await page.getByLabel('Email Address*').fill('asha@example.com');
  await page.getByLabel('Subject').selectOption('volunteer');
  await page.getByLabel('Your Message*').fill('I can help on weekends with first aid.');
  await page.locator('#consent').check();
}

const send = (page) => page.getByRole('button', { name: 'Send Message' }).click();
const failure = (page) => page.locator('.contact-send-failure');
const notSent = (page) => expect(page.getByText('Message sent')).toHaveCount(0);

test.describe('contact form', () => {
  test('with no backend configured it says the message was not sent and keeps what was typed', async ({ page, problems }) => {
    const posts = [];
    page.on('request', (request) => { if (request.method() === 'POST') posts.push(request.url()); });
    await openForm(page);
    await send(page);

    await expect(failure(page)).toBeVisible();
    await expect(failure(page)).toContainText('Your message was not sent');
    await expect(failure(page)).toContainText('What you typed is still in the form');
    await expect(failure(page)).toContainText('not for emergencies');
    await notSent(page);
    await expect(page.getByText(/received your inquiry|will respond within/)).toHaveCount(0);

    // The form and the text are still there, and the button works again.
    await expect(page.locator('#contactForm')).toBeVisible();
    await expect(page.getByLabel('Your Message*')).toHaveValue('I can help on weekends with first aid.');
    await expect(page.getByRole('button', { name: 'Send Message' })).toBeEnabled();

    // The recovery options are the contact details already on the page. The email link only opens a mail app.
    const mail = failure(page).locator('a[href^="mailto:"]');
    await expect(mail).toHaveAttribute('href', /^mailto:info@reliefconnect\.org\?subject=/);
    const body = new URLSearchParams((await mail.getAttribute('href')).split('?')[1]).get('body');
    expect(body).toContain('I can help on weekends with first aid.');
    await expect(failure(page).locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+18005551234');

    // Nothing was sent anywhere.
    expect(posts).toEqual([]);
    expect(problems.blocked.filter((request) => request.startsWith('POST'))).toEqual([]);
  });

  test('a confirmed message shows "Message sent" and sends exactly the form fields', async ({ page }) => {
    const requests = await configureBackend(page, (route) => route.fulfill({ status: 201, json: { status: 'received' } }));
    await openForm(page);
    await send(page);

    const done = page.locator('.form-success');
    await expect(done).toContainText('Message sent');
    await expect(done).toContainText('delivered to the RELIEF team');
    await expect(page.locator('#contactForm')).toHaveCount(0);
    await expect(failure(page)).toHaveCount(0);

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('POST');
    expect(requests[0].body).toEqual({
      name: 'Asha Rao',
      email: 'asha@example.com',
      subject: 'volunteer',
      message: 'I can help on weekends with first aid.',
      consent: true
    });
  });

  test('a server error is reported as not sent, never as success', async ({ page }) => {
    const requests = await configureBackend(page, (route) => route.fulfill({ status: 500, body: 'boom' }));
    await openForm(page);
    await send(page);

    await expect(failure(page)).toContainText('Your message was not sent');
    await notSent(page);
    expect(requests).toHaveLength(1);
    await expect(page.getByLabel('Your Message*')).toHaveValue('I can help on weekends with first aid.');
  });

  test('a 200 reply that does not confirm receipt is not a success', async ({ page }) => {
    await configureBackend(page, (route) => route.fulfill({ json: { ok: true } }));
    await openForm(page);
    await send(page);

    await expect(failure(page)).toContainText('did not confirm that it received it');
    await notSent(page);
    await expect(page.locator('#contactForm')).toBeVisible();
  });

  test('a dropped connection is reported as not sent', async ({ page }) => {
    await configureBackend(page, (route) => route.abort('connectionfailed'));
    await openForm(page);
    await send(page);
    await expect(failure(page)).toContainText('Your message was not sent');
    await notSent(page);
  });

  test('a rejected message and a rate limit from the server each say so', async ({ page }) => {
    let status = 422;
    await configureBackend(page, (route) => route.fulfill({ status, json: { errors: { message: 'too short' } } }));
    await openForm(page);
    await send(page);
    await expect(failure(page)).toContainText('did not accept it');

    status = 429;
    await send(page);
    await expect(failure(page)).toContainText('too many messages');
    await expect(failure(page)).toHaveCount(1);
  });

  test('the rate limit still stops repeated attempts', async ({ page }) => {
    await openForm(page);
    for (let attempt = 0; attempt < 3; attempt++) {
      await send(page);
      await expect(failure(page)).toContainText('Your message was not sent');
    }
    await send(page);
    await expect(page.locator('.form-guard-message')).toContainText('Too many attempts');
    await notSent(page);
    await expect(page.getByLabel('Your Message*')).toHaveValue('I can help on weekends with first aid.');
  });

  test('validation still runs before anything is sent', async ({ page }) => {
    const requests = await configureBackend(page, (route) => route.fulfill({ status: 201, json: { status: 'received' } }));
    await page.clock.install();
    await page.goto('/pages/contact.html');
    await page.clock.fastForward(2500);
    await page.locator('#contactForm').evaluate((form) => { form.noValidate = true; });
    await send(page);
    await expect(page.getByText('Please enter your name')).toBeVisible();
    expect(requests).toEqual([]);
  });
});
