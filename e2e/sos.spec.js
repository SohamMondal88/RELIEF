// Journey: Emergency SOS on the ambulances page.
// No real call, SMS or request is ever made: tel: and sms: links are only inspected (never followed),
// the SOS endpoint is a fake host answered by page.route, and geolocation is mocked.
const { test, expect } = require('./fixtures');
const { useGeolocation, relief } = require('./helpers');

const ENDPOINT = 'https://sos.mock.relief.test/api/sos';

// Tests that need a configured endpoint set it before the page scripts run.
async function configureEndpoint(page, handler) {
  await page.addInitScript((url) => { window.RELIEF_SOS_ENDPOINT = url; }, ENDPOINT);
  const requests = [];
  await page.route(ENDPOINT, async (route) => {
    requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await handler(route);
  });
  return requests;
}

async function openDialog(page) {
  await page.goto('/pages/ambulances.html');
  await page.locator('#relief-emergency-sos-trigger').click();
  const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const confirm = (dialog) => dialog.getByRole('button', { name: 'Confirm Emergency SOS Request' });

test.afterEach(async ({ page }) => {
  // Whatever a test did, no phone call or SMS may have been started.
  const guard = await relief(page).catch(() => null);
  if (guard) expect(guard.opened, 'window.open calls').toEqual([]);
});

// The fixture blocks every request that leaves the local site, so the Leaflet CDN script never loads here.
// ambulances.js must still work and say that the map is missing (issue #75).
test('the ambulances page works without the map library and says the map could not load', async ({ page, problems }) => {
  await page.goto('/pages/ambulances.html');
  expect(problems.blocked.some((request) => request.includes('leaflet'))).toBe(true);
  await expect(page.locator('.ambulance-item')).toHaveCount(4);
  await expect(page.getByRole('status').filter({ hasText: 'The map could not be loaded' })).toBeVisible();
  await expect(page.locator('#map')).toBeHidden();
  expect(problems.pageErrors).toEqual([]);
});

test.describe('SOS confirmation dialog', () => {
  test('opens as a modal dialog, starts on Cancel, and warns before anything is sent', async ({ page }) => {
    await page.goto('/pages/ambulances.html');
    const trigger = page.locator('#relief-emergency-sos-trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const dialog = page.getByRole('dialog', { name: 'Emergency SOS' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByRole('button', { name: 'Cancel Emergency SOS' })).toBeFocused();
    await expect(dialog).toContainText('CRITICAL SAFETY NOTICE');
    await expect(dialog.getByLabel('Select emergency region')).toHaveValue('IN');
    // Nothing has been requested yet.
    await expect(dialog.getByRole('alert')).toHaveCount(0);
  });

  test('Escape and Cancel close it without sending anything', async ({ page }) => {
    const dialog = await openDialog(page);
    const trigger = page.locator('#relief-emergency-sos-trigger');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await page.getByRole('button', { name: 'Cancel Emergency SOS' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('Processing Emergency SOS...')).toHaveCount(0);
  });

  // Real bug found while writing these tests: a click on the SOS button runs the button's own handler and then
  // the document-level handler in emergency-sos.js, so the dialog is opened twice. The second open records the
  // dialog's Cancel button as "previously focused", so on close focus is lost instead of returning to the SOS
  // button (and a second keydown listener is left behind). Remove .fixme once openConfirmationDialog is guarded.
  test.fixme('closing the dialog returns focus to the SOS button', async ({ page }) => {
    await openDialog(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#relief-emergency-sos-trigger')).toBeFocused();
  });

  test('Tab stays inside the dialog', async ({ page }) => {
    const dialog = await openDialog(page);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });
});

test.describe('SOS outcomes', () => {
  test('with no backend configured it says dispatch is unavailable and gives phone and SMS options', async ({ page }) => {
    const dialog = await openDialog(page);
    await confirm(dialog).click();

    const banner = dialog.getByRole('alert');
    await expect(banner).toContainText('Web Dispatch Unavailable');
    await expect(banner).toContainText('No live emergency dispatch backend is configured');
    await expect(dialog).toContainText('have NOT been contacted online');
    await expect(dialog.getByText('SOS Request Accepted')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Retry SOS/ })).toBeVisible();

    // The phone and SMS fallbacks exist and are real tel:/sms: links, but the test never follows them.
    await expect(dialog.locator('a.relief-sos-btn-call[href="tel:112"]')).toBeAttached();
    await expect(dialog.locator('#relief-sos-sms-btn')).toHaveAttribute('href', /^sms:112\?body=/);
    expect((await relief(page)).links).toEqual([]);
  });

  test('a server error is reported as not confirmed, never as success', async ({ page }) => {
    const requests = await configureEndpoint(page, (route) => route.fulfill({ status: 500, body: 'boom' }));
    const dialog = await openDialog(page);
    await confirm(dialog).click();

    await expect(dialog.getByRole('alert')).toContainText('The server responded with an error (HTTP 500)');
    await expect(dialog).toContainText('Do not assume assistance has been dispatched');
    await expect(dialog.getByText('SOS Request Accepted')).toHaveCount(0);
    expect(requests).toHaveLength(1);
  });

  test('a 200 reply that does not confirm dispatch is also a failure', async ({ page }) => {
    await configureEndpoint(page, (route) => route.fulfill({ json: { received: true } }));
    const dialog = await openDialog(page);
    await confirm(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('did not confirm dispatch');
    await expect(dialog.getByText('SOS Request Accepted')).toHaveCount(0);
  });

  test('a dropped connection is reported as a network failure', async ({ page }) => {
    await configureEndpoint(page, (route) => route.abort('connectionfailed'));
    const dialog = await openDialog(page);
    await confirm(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('A network connection failure occurred');
  });

  test('Retry sends a second request and can succeed after a failure', async ({ page }) => {
    let calls = 0;
    const requests = await configureEndpoint(page, (route) => {
      calls += 1;
      return calls === 1
        ? route.fulfill({ status: 503, body: 'busy' })
        : route.fulfill({ json: { status: 'accepted', requestId: 'mock-1' } });
    });
    const dialog = await openDialog(page);
    await confirm(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('HTTP 503');

    await dialog.getByRole('button', { name: /Retry SOS/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('SOS Request Accepted');
    await expect(dialog.getByRole('button', { name: /Retry SOS/ })).toHaveCount(0);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.idempotencyKey).not.toBe(requests[0].body.idempotencyKey);
  });

  test('success is shown only when the server confirms, and the request carries the mocked location', async ({ page }) => {
    await useGeolocation(page, { lat: 22.5726, lng: 88.3639 });
    const requests = await configureEndpoint(page, (route) => route.fulfill({ json: { status: 'accepted', requestId: 'mock-42' } }));
    const dialog = await openDialog(page);
    await confirm(dialog).click();

    await expect(dialog.getByRole('alert')).toContainText('SOS Request Accepted');
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toMatchObject({
      urgency: 'HIGH',
      serviceType: 'EMERGENCY_AMBULANCE',
      region: 'IN',
      locationStatus: 'retrieved'
    });
    expect(requests[0].body.location).toMatchObject({ lat: 22.5726, lng: 88.3639 });
    expect(requests[0].headers['x-idempotency-key']).toBeTruthy();
  });

  test('denied location does not block SOS: the request goes without coordinates', async ({ page }) => {
    const requests = await configureEndpoint(page, (route) => route.fulfill({ json: { status: 'accepted' } }));
    const dialog = await openDialog(page);
    await confirm(dialog).click();
    await expect(dialog.getByRole('alert')).toContainText('SOS Request Accepted');
    expect(requests[0].body.locationStatus).toBe('denied');
    expect(requests[0].body.location).toBeNull();
  });

  test('offline: no request is sent and the page says the device is offline', async ({ page, context }) => {
    const requests = await configureEndpoint(page, (route) => route.fulfill({ json: { status: 'accepted' } }));
    const dialog = await openDialog(page);
    await context.setOffline(true);
    await confirm(dialog).click();

    await expect(dialog.getByRole('alert')).toContainText('Device is Offline');
    await expect(dialog).toContainText('use the SMS fallback');
    expect(requests).toHaveLength(0);
  });

  test('closing is blocked while a request is in flight, and the result can be closed afterwards', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await configureEndpoint(page, async (route) => { await gate; await route.fulfill({ status: 500, body: 'late' }); });
    const dialog = await openDialog(page);
    await confirm(dialog).click();

    await expect(dialog.getByText('Processing Emergency SOS...')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close emergency window' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    release();
    await expect(dialog.getByRole('alert')).toContainText('HTTP 500');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
