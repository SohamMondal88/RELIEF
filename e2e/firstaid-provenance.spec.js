// Journey: every first aid article says where it comes from and whether it was reviewed (Issue #79).
// No article has a recorded source or review yet, so each one must say so instead of leaving a gap.
const { test, expect } = require('./fixtures');

test.describe('first aid provenance', () => {
  test('every article says the source is not recorded and that it is not reviewed', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    const guides = page.locator('.guide-item');
    const count = await guides.count();
    expect(count).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < count; i++) {
      const block = guides.nth(i).locator('.guide-provenance');
      await expect(block).toHaveCount(1);
      await expect(block).toContainText('Source');
      await expect(block).toContainText('Source not recorded');
      await expect(block).toContainText('Last reviewed');
      await expect(block).toContainText('Not recorded');
      await expect(block).toContainText('Review status');
      await expect(block).toContainText('Not reviewed');
      await expect(block.locator('a')).toHaveCount(0);
    }
  });

  for (const [name, size] of [['desktop', { width: 1280, height: 900 }], ['375px phone', { width: 375, height: 800 }], ['320px phone', { width: 320, height: 700 }]]) {
    test(`the block is not clipped when an article is opened (${name})`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto('/pages/firstaid.html');
      for (const category of ['cpr', 'burns', 'choking', 'cuts', 'fractures']) {
        await page.locator(`.category-card[data-category="${category}"]`).click();
        const guide = page.locator('.guide-item').first();
        await guide.locator('.guide-header').click();
        const block = guide.locator('.guide-provenance');
        await expect(block).toBeVisible();
        await page.waitForTimeout(700); // the body opens with a 0.3s height transition
        // the article body has a max-height, so check the block ends inside it
        const clipped = await guide.evaluate((el) => {
          const content = el.querySelector('.guide-content');
          const note = el.querySelector('.guide-provenance');
          // cut off either by the block ending below the body, or by the body being taller than its max-height
          return note.getBoundingClientRect().bottom > content.getBoundingClientRect().bottom + 1 || content.scrollHeight > content.clientHeight + 1;
        });
        expect(clipped, category).toBe(false);
      }
    });
  }

  test('the same block built from a checked record shows the link, the date and the status, and refuses an unsafe link', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    const result = await page.evaluate(() => {
      const P = window.ReliefProvenance;
      const ok = P.buildElement(document, { status: 'source-checked', sourceUrl: 'https://example.org/first-aid', sourceName: 'Example Authority', lastReviewed: '2026-11-09' });
      const unsafe = P.buildElement(document, { status: 'source-checked', sourceUrl: 'javascript:alert(1)', sourceName: '<b>x</b>', lastReviewed: '2026-11-09' });
      const link = ok.querySelector('a');
      return {
        text: ok.textContent,
        href: link && link.getAttribute('href'),
        rel: link && link.getAttribute('rel'),
        unsafeLinks: unsafe.querySelectorAll('a').length,
        unsafeHtml: unsafe.querySelectorAll('b').length,
        unsafeText: unsafe.textContent
      };
    });
    expect(result.text).toContain('Example Authority');
    expect(result.text).toContain('9 Nov 2026');
    expect(result.text).toContain('Source checked, not a clinical review');
    expect(result.text).toContain('Checked against the source on');
    expect(result.text).not.toContain('Last reviewed');
    expect(result.href).toBe('https://example.org/first-aid');
    expect(result.rel).toBe('noopener noreferrer');
    expect(result.unsafeLinks).toBe(0);
    expect(result.unsafeHtml).toBe(0);
    expect(result.unsafeText).toContain('Source not recorded');
    expect(result.unsafeText).toContain('Not reviewed');
  });

  test('it also shows in the saved copy when the network is gone', async ({ page, context }) => {
    await page.goto('/pages/firstaid.html');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
      const names = await caches.keys();
      if (!names.length) return 0;
      const keys = await (await caches.open(names[0])).keys();
      return keys.filter((r) => r.url.endsWith('/assets/js/content-provenance.js')).length;
    })).toBe(1);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.guide-item').first().locator('.guide-provenance')).toContainText('Source not recorded');
  });
});
