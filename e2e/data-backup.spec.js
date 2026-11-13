// Journey: back up and restore the dashboard data (reminders and timeline) as a JSON file (Issue #82).
const fs = require('fs');
const { test, expect } = require('./fixtures');
const { storedJson } = require('./helpers');

const REMINDERS = 'relief_reminders_v1';
const HISTORY = 'relief_history_v1';

async function addReminder(page, medicine, time) {
  await page.getByLabel('Medicine or label').fill(medicine);
  await page.getByLabel('Time (every day)').fill(time);
  await page.getByRole('button', { name: 'Save Reminder' }).click();
  await expect(page.locator('.reminder-item', { hasText: medicine })).toBeVisible();
}

const backupFile = (mutate) => {
  const doc = {
    format: 'relief-local-backup', version: 1, exportedAt: '2026-11-13T10:00:00.000Z', notice: 'test',
    data: {
      reminders: [{ id: 'imp1', medicine: 'Imported Iron', instructions: '', time: '06:15', startDate: '', endDate: '', status: 'active', scheduleMode: 'local', timeZone: 'Asia/Kolkata', lastNotifiedOn: '', lastNotifiedAtMs: 0 }],
      timeline: [{ date: '2026-03-01', event: 'Imported entry', status: 'from a file' }]
    }
  };
  if (mutate) mutate(doc);
  return { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) };
};

test.describe('dashboard backup and restore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pages/dashboard.html');
    await expect(page.locator('#reminder-list')).toContainText('No reminders yet.');
  });

  test('the section says it is a local backup and not a medical record', async ({ page }) => {
    const section = page.locator('#data-backup');
    await expect(section).toContainText('not a medical record');
    await expect(section).toContainText('Anyone who gets the file can read your medicine names');
    await expect(section).toContainText('Deleting your data in RELIEF does not delete a file you already downloaded');
  });

  test('download: with nothing saved it says so, with a reminder it downloads a versioned file', async ({ page }) => {
    await page.getByRole('button', { name: 'Download backup' }).click();
    await expect(page.locator('#backup-status')).toContainText('There is nothing to back up yet');

    await addReminder(page, 'Vitamin D', '08:00');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download backup' }).click()
    ]);
    expect(download.suggestedFilename()).toMatch(/^relief-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(doc).toMatchObject({ format: 'relief-local-backup', version: 1 });
    expect(doc.notice).toContain('not a medical record');
    expect(doc.data.reminders).toHaveLength(1);
    expect(doc.data.reminders[0]).toMatchObject({ medicine: 'Vitamin D', time: '08:00' });
    // The two example rows the dashboard seeds are not the user's own entries.
    expect(JSON.stringify(doc.data.timeline)).not.toContain('Symptom check completed');
    expect(JSON.stringify(doc.data.timeline)).toContain('Medication reminder created');
    await expect(page.locator('#backup-status')).toContainText('Backup downloaded');
  });

  test('restore: a valid file is previewed first, then replaces the reminders and timeline', async ({ page }) => {
    await addReminder(page, 'Vitamin D', '08:00');
    await page.locator('#backup-file').setInputFiles(backupFile());

    const preview = page.locator('#backup-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('In the file: 1 reminder and 1 timeline entry');
    await expect(preview).toContainText('Saved in this browser now: 1 reminder');
    await expect(preview).toContainText('Imported Iron at 06:15');
    await expect(preview).toContainText('cannot be undone');
    // Nothing has been replaced yet.
    expect((await storedJson(page, REMINDERS)).map((r) => r.medicine)).toEqual(['Vitamin D']);
    await expect(page.locator('#backup-preview-title')).toBeFocused();

    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.locator('#backup-status')).toContainText('Backup restored');
    await expect(page.locator('.reminder-item')).toHaveCount(1);
    await expect(page.locator('.reminder-item')).toContainText('Imported Iron');
    await expect(page.locator('#kpi-reminders')).toHaveText('1');
    await expect(page.locator('#timeline')).toContainText('Imported entry');
    expect((await storedJson(page, REMINDERS)).map((r) => r.medicine)).toEqual(['Imported Iron']);

    // The page keeps what was restored when it is opened again.
    await page.reload();
    await expect(page.locator('.reminder-item')).toContainText('Imported Iron');
    await expect(page.locator('#timeline')).toContainText('Imported entry');
  });

  test('restore: cancel (and Escape) leave everything as it was', async ({ page }) => {
    await addReminder(page, 'Vitamin D', '08:00');
    const before = await storedJson(page, REMINDERS);
    await page.locator('#backup-file').setInputFiles(backupFile());
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#backup-preview')).toBeHidden();
    await expect(page.locator('#backup-status')).toContainText('Nothing was changed');
    expect(await storedJson(page, REMINDERS)).toEqual(before);

    await page.locator('#backup-file').setInputFiles(backupFile());
    await expect(page.locator('#backup-preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#backup-preview')).toBeHidden();
    expect(await storedJson(page, REMINDERS)).toEqual(before);
  });

  const BAD = [
    ['not JSON', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"format": ') }, 'not valid JSON'],
    ['another kind of JSON file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"package"}') }, 'not a RELIEF backup'],
    ['a newer backup version', backupFile((d) => { d.version = 2; }), 'newer version of RELIEF'],
    ['one broken reminder next to a good one', backupFile((d) => { d.data.reminders.push({ id: 'bad', medicine: 'Broken', time: '99:99' }); }), 'none of it was loaded'],
    ['a file over 512 KB', { name: 'big.json', mimeType: 'application/json', buffer: Buffer.alloc(513 * 1024, 32) }, 'too large']
  ];

  for (const [name, file, message] of BAD) {
    test(`restore: ${name} is refused and nothing is changed`, async ({ page }) => {
      await addReminder(page, 'Vitamin D', '08:00');
      const before = { reminders: await storedJson(page, REMINDERS), history: await storedJson(page, HISTORY) };
      await page.locator('#backup-file').setInputFiles(file);
      const status = page.locator('#backup-status');
      await expect(status).toContainText(message);
      await expect(status).toContainText('Nothing was changed');
      await expect(page.locator('#backup-preview')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Replace with this backup' })).toBeHidden();
      expect({ reminders: await storedJson(page, REMINDERS), history: await storedJson(page, HISTORY) }).toEqual(before);
      await expect(page.locator('.reminder-item')).toContainText('Vitamin D');
    });
  }

  test('restore: a browser that refuses to save leaves the old data in place and says so', async ({ page }) => {
    await addReminder(page, 'Vitamin D', '08:00');
    await page.locator('#backup-file').setInputFiles(backupFile());
    await expect(page.locator('#backup-preview')).toBeVisible();
    // Simulated: the second write (the timeline) throws a quota error.
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      let count = 0;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'relief_history_v1' && count++ === 0) throw new DOMException('full', 'QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    const before = await storedJson(page, REMINDERS);
    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.locator('#backup-status')).toContainText('refused to save the backup');
    await expect(page.locator('#backup-status')).toContainText('put back as they were');
    expect(await storedJson(page, REMINDERS)).toEqual(before);
    await expect(page.locator('.reminder-item')).toContainText('Vitamin D');
  });

  test('restore leaves unrelated storage alone', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('someone_elses_key', 'keep me'));
    await page.locator('#backup-file').setInputFiles(backupFile());
    await page.getByRole('button', { name: 'Replace with this backup' }).click();
    await expect(page.locator('#backup-status')).toContainText('Backup restored');
    expect(await page.evaluate(() => localStorage.getItem('someone_elses_key'))).toBe('keep me');
  });
});
