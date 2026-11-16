// Journey: send a moderated form once, even when the person is impatient. Covers the health event form and the
// facility correction form. The backend is faked with page.route on this site's own origin, so nothing leaves
// the machine. See docs/FORM_PROTECTION.md.
const { test, expect } = require('./fixtures');

const JSON_HEADERS = { 'content-type': 'application/json' };

// Points the pages at a "backend" on the same origin (an http address is only allowed for a local one) and
// answers its write route after the test lets it go. Returns the requests it saw.
async function fakeBackend(page, route) {
  await page.addInitScript(() => { window.RELIEF_BACKEND_URL = window.location.origin; });
  const state = { posts: [], release: null };
  const gate = new Promise((resolve) => { state.release = resolve; });
  await page.route('**/v1/health-events', (r) => r.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ events: [] }) }));
  await page.route(route, async (r) => {
    state.posts.push({ key: r.request().headers()['idempotency-key'], body: r.request().postData() });
    await gate;
    await r.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ id: 'srv-1', status: 'pending' }) });
  });
  return state;
}

async function fillEvent(page) {
  await page.getByLabel('Event name').fill('Free Eye Camp');
  await page.locator('#event-type').selectOption('screening');
  await page.locator('#event-start-date-picker').fill('2027-03-10');
  await page.locator('#event-start-time').fill('09:00');
  await page.locator('#event-end-time').fill('15:00');
  await page.locator('#event-district').fill('Purulia');
  await page.locator('#event-venue').fill('Community hall, Raghunathpur');
  await page.locator('#event-organiser').fill('Lions Club Purulia');
  await page.locator('#event-eligibility').fill('Everyone');
  await page.locator('#event-services').fill('Vision test, Cataract screening');
  await page.locator('#event-phone').fill('+91 98300 12345');
}

test.describe('health event form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/health-events.html');
  });

  test('double-clicking Submit sends one request and the form says it is busy', async ({ page }) => {
    const backend = await fakeBackend(page, '**/v1/health-events/submissions');
    await page.reload();
    await fillEvent(page);
    const submit = page.locator('#event-submit-form button[type="submit"]');

    await submit.dblclick();
    await expect(page.locator('#event-submit-status')).toContainText('Sending your event');
    await expect(page.locator('#event-submit-form')).toHaveAttribute('aria-busy', 'true');
    await expect(submit).toBeDisabled();
    await expect.poll(() => backend.posts.length).toBe(1);

    backend.release();
    await expect(page.locator('#event-submit-status')).toContainText('Thank you');
    await expect(page.locator('#event-submit-form')).not.toHaveAttribute('aria-busy', 'true');
    await expect(submit).toBeEnabled();
    expect(backend.posts).toHaveLength(1);
    expect(backend.posts[0].key, 'the send carries an idempotency key').toBeTruthy();
  });

  test('submit events fired again while one is pending are ignored', async ({ page }) => {
    const backend = await fakeBackend(page, '**/v1/health-events/submissions');
    await page.reload();
    await fillEvent(page);
    await page.locator('#event-submit-form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); form.requestSubmit(); });
    await expect.poll(() => backend.posts.length).toBe(1);
    backend.release();
    await expect(page.locator('#event-submit-status')).toContainText('Thank you');
    expect(backend.posts).toHaveLength(1);
  });

  test('a send that fails with an unexpected error gives the button back and says what to do', async ({ page }) => {
    // Make the first send reject inside the page, the way an unexpected error would. The store is built when
    // the script loads, so the wrapper has to be in place before that.
    await page.addInitScript(() => {
      var real;
      Object.defineProperty(window, 'HealthEvents', {
        configurable: true,
        get: function () { return real; },
        set: function (api) {
          var create = api.createStore;
          api.createStore = function (deps) {
            var store = create(deps);
            var submit = store.submit;
            var failed = false;
            store.submit = function () {
              if (failed) return submit.apply(store, arguments);
              failed = true;
              return Promise.reject(new Error('boom'));
            };
            return store;
          };
          real = api;
        }
      });
    });
    await page.reload();
    await fillEvent(page);
    const submit = page.locator('#event-submit-form button[type="submit"]');
    await submit.click();
    await expect(page.locator('#event-submit-status')).toContainText('was not sent');
    await expect(page.locator('#event-submit-status')).toHaveAttribute('data-tone', 'error');
    await expect(submit).toBeEnabled();
    await expect(page.locator('#event-submit-form')).not.toHaveAttribute('aria-busy', 'true');
    // What was typed is still there, and a second press goes through (demo mode saves it in this browser).
    await expect(page.getByLabel('Event name')).toHaveValue('Free Eye Camp');
    await submit.click();
    await expect(page.locator('#event-submit-status')).toContainText('Saved in this browser');
  });
});

test.describe('facility correction form', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.RELIEF_BACKEND_URL = window.location.origin; });
  });

  async function openForm(page) {
    await page.goto('/pages/hospitals.html');
    await expect(page.locator('#correction-section')).toBeVisible();
    await page.locator('#correction-facility').selectOption({ index: 1 });
    await page.locator('#correction-field').selectOption('hours');
    await page.locator('#correction-value').fill('Mon to Sun 8:00 to 20:00');
  }

  test('double-clicking Send suggestion sends one request and the form says it is busy', async ({ page }) => {
    const posts = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/v1/facility-corrections', async (r) => {
      posts.push(r.request().headers()['idempotency-key']);
      await gate;
      await r.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ id: 'srv-1', status: 'pending' }) });
    });
    await openForm(page);
    const send = page.locator('#correction-form button[type="submit"]');

    await send.dblclick();
    await expect(page.locator('#correction-status')).toContainText('Sending your suggestion');
    await expect(page.locator('#correction-form')).toHaveAttribute('aria-busy', 'true');
    await expect(send).toBeDisabled();
    await expect.poll(() => posts.length).toBe(1);

    release();
    await expect(page.locator('#correction-status')).toContainText('Thank you');
    await expect(send).toBeEnabled();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toBeTruthy();
  });

  test('submit events fired again while one is pending are ignored', async ({ page }) => {
    const posts = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/v1/facility-corrections', async (r) => {
      posts.push(r.request().postData());
      await gate;
      await r.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify({ id: 'srv-1', status: 'pending' }) });
    });
    await openForm(page);
    await page.locator('#correction-form').evaluate((form) => { form.requestSubmit(); form.requestSubmit(); form.requestSubmit(); });
    await expect.poll(() => posts.length).toBe(1);
    release();
    await expect(page.locator('#correction-status')).toContainText('Thank you');
    expect(posts).toHaveLength(1);
  });
});
