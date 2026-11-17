// Journey: the same search typed in different ways gives the same list (issue #175).
// Extra spaces, capitals, a no-break space and a zero width space (both come along when text is copied)
// must not change what the hospital, doctor, pharmacy and first aid searches find.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./fixtures');

const FACILITIES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'facilities.json'), 'utf8')).facilities;

// The map pages report "L is not defined" because the fixtures block the map library, as in accessibility.spec.js.
test.use({ allowedPageErrors: [/^L is not defined$/] });

test.describe('doctors', () => {
  test('capitals, extra spaces and a no-break space find the same doctor', async ({ page }) => {
    await page.goto('/pages/doctors.html');
    const cards = page.locator('.doctor-card');
    const search = page.getByLabel('Search by specialty, doctor name, or condition');
    const total = await cards.count();
    for (const query of ['cardiologist', '  CARDIOLOGIST  ', 'Cardio​logist', 'sarah  johnson', 'johnson   sarah']) {
      await search.fill(query);
      await expect(cards, JSON.stringify(query)).toHaveCount(1);
      await expect(cards.first()).toContainText('Sarah Johnson');
    }
    await search.fill('   ');
    await expect(cards).toHaveCount(total);
  });
});

test.describe('pharmacies', () => {
  test('double spaces and a trailing space still find the pharmacy, a blank box lists all', async ({ page }) => {
    await page.goto('/pages/pharmacies.html');
    const cards = page.locator('.pharmacy-card');
    const search = page.getByLabel('Search by pharmacy name or medicine');
    const total = await cards.count();
    await search.fill('greenleaf pharmacy');
    const expected = await cards.count();
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(total);
    for (const query of ['greenleaf   pharmacy', 'GREENLEAF PHARMACY ', ' greenleaf pharmacy']) {
      await search.fill(query);
      await expect(cards, JSON.stringify(query)).toHaveCount(expected);
    }
    await search.fill('   ');
    await expect(cards).toHaveCount(total);
  });
});

test.describe('hospitals', () => {
  test('a zero width space or a no-break space in the query changes nothing', async ({ page }) => {
    await page.goto('/pages/hospitals.html');
    const cards = page.locator('.hospital-card');
    await expect(cards).toHaveCount(FACILITIES.length);
    const search = page.getByLabel('Search by name, area or service');
    await search.fill('Bankura');
    const expected = await cards.count();
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(FACILITIES.length);
    for (const query of ['BANKURA', 'Bank​ura', '  bankura  ']) {
      await search.fill(query);
      await expect(cards, JSON.stringify(query)).toHaveCount(expected);
    }
    await search.fill('​ ');
    await expect(cards).toHaveCount(FACILITIES.length);
  });
});

test.describe('first aid', () => {
  test('the search reads the words of a guide, not its markup, and ignores extra spaces', async ({ page }) => {
    await page.goto('/pages/firstaid.html');
    const guides = page.locator('.guide-item');
    const search = page.getByLabel('Search first aid guides');
    await expect(guides.first()).toBeVisible();
    const all = await guides.count();

    // "div", "span" and a class name are in the HTML of the guides but not in anything a person reads
    for (const markup of ['div', 'span', 'guide-warning']) {
      await search.fill(markup);
      await expect(page.getByText('No guides found matching your search'), markup).toBeVisible();
    }

    await search.fill('  BURN ');
    await expect(guides.first()).toContainText(/burn/i);
    const burn = await guides.count();
    expect(burn).toBeLessThan(all);
    await search.fill('bu​rn');
    await expect(guides).toHaveCount(burn);

    await search.fill('   ');
    await expect(guides).toHaveCount(all);
  });
});
