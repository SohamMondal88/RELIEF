// Browser tests for the critical RELIEF journeys. See docs/E2E_TESTING.md.
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);
// Point E2E_BASE_URL at your own server (for example python3 -m http.server 8000) to skip the built-in one.
const externalBase = process.env.E2E_BASE_URL;
const baseURL = externalBase || `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30000,
  expect: { timeout: 7000 },
  reporter: isCI
    ? [['github'], ['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    // The sign-up form floats forever, which makes Playwright wait for it to be "stable" before a click.
    // The site's own prefers-reduced-motion rules switch those animations off.
    contextOptions: { reducedMotion: 'reduce' },
    // Failures keep a trace (open with: npx playwright show-trace <trace.zip>) and a screenshot.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.RELIEF_CHROMIUM_PATH
      ? { executablePath: process.env.RELIEF_CHROMIUM_PATH }
      : {}
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: externalBase
    ? undefined
    : {
        command: `node e2e/static-server.js ${PORT}`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 15000
      }
});
