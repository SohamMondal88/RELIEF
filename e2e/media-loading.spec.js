// Journey: pictures that are missing or slow (issue #195). A page must not ask for image files that are not there,
// must not move its content when a picture arrives late, and a card must not shrink when its photo is missing.
const { test, expect } = require('./fixtures');
const { holdRequests } = require('./helpers');

// The map pages report "L is not defined" because the fixtures block the map library, as in accessibility.spec.js.
test.use({ allowedPageErrors: [/^(L is not defined|Cannot read properties of null \(reading 'addEventListener'\))$/] });

const IMAGE_URL = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

test.describe('no page asks for an image file that does not exist', () => {
  for (const route of ['/index.html', '/pages/about.html', '/pages/contact.html', '/pages/blog.html', '/pages/doctors.html', '/pages/pharmacies.html', '/pages/ambulances.html']) {
    test(route, async ({ page, problems }) => {
      await page.route('**/_vercel/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
      await page.goto(route, { waitUntil: 'load' });
      // Lazy pictures and the long pages: go to the bottom so every request that is going to be made is made.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForLoadState('networkidle');
      const failed = problems.firstParty.filter((p) => IMAGE_URL.test(p.url));
      expect(failed, 'first-party images that failed').toEqual([]);
    });
  }
});

test.describe('a late picture does not move the page', () => {
  for (const route of ['/404.html', '/pages/about.html', '/pages/blog.html', '/pages/login.html', '/pages/signup.html', '/pages/contact.html', '/pages/doctors.html', '/pages/firstaid.html']) {
    test(route, async ({ page }) => {
      const held = await holdRequests(page, /\/assets\/images\/.*\.(png|jpe?g|webp)$/i);
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);

      const boxes = () => page.evaluate(() => [...document.images]
        .filter((img) => !/^https?:/.test(img.getAttribute('src')))
        .map((img) => {
          const r = img.getBoundingClientRect();
          return { src: img.getAttribute('src').split('/').pop(), w: Math.round(r.width), h: Math.round(r.height) };
        }));

      const before = await boxes();
      expect(before.length).toBeGreaterThan(0);
      await held.release();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForFunction(() => [...document.images].every((img) => img.complete), null, { timeout: 8000 });
      await page.waitForTimeout(200);
      const after = await boxes();

      expect(after.length).toBe(before.length);
      after.forEach((box, i) => {
        // Boxes that are not shown at this size (a hidden menu logo) have no size before or after.
        if (!box.w && !box.h) return;
        expect(before[i].w, `${box.src} width before and after the file arrived`).toBeCloseTo(box.w, -0.5);
        expect(before[i].h, `${box.src} height before and after the file arrived`).toBeCloseTo(box.h, -0.5);
      });
    });
  }
});

test.describe('a card keeps its shape when its photo is missing', () => {
  test('doctor cards: a block of fixed height, no photo requested', async ({ page, problems }) => {
    await page.goto('/pages/doctors.html');
    const image = page.locator('.doctor-image').first();
    await expect(image).toBeVisible();
    expect((await image.boundingBox()).height).toBeGreaterThanOrEqual(190);
    await expect(image).toHaveCSS('background-image', 'none');
    expect(problems.firstParty.filter((p) => IMAGE_URL.test(p.url))).toEqual([]);
    await expect(page.locator('.doctor-card', { hasText: 'Sarah Johnson' })).toHaveCount(1);
  });

  test('pharmacy cards: a block of fixed height, no photo requested', async ({ page, problems }) => {
    await page.goto('/pages/pharmacies.html');
    const image = page.locator('.pharmacy-image').first();
    await expect(image).toBeVisible();
    expect((await image.boundingBox()).height).toBeGreaterThanOrEqual(170);
    await expect(image).toHaveCSS('background-image', 'none');
    expect(problems.firstParty.filter((p) => IMAGE_URL.test(p.url))).toEqual([]);
    await expect(page.locator('.pharmacy-card', { hasText: 'City Pharmacy' })).toHaveCount(1);
  });
});
