import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const isCI = process.env.CI === 'true';

/**
 * Playwright configuration for Tauri end-to-end tests.
 *
 * The Tauri app must be built first with `npm run tauri:build:no-bundle`.
 * The fixture (`fixtures.ts`) launches the built binary directly and connects
 * to the WebView2/Chromium remote-debugging port via CDP.
 */
export default defineConfig({
  testDir: path.resolve(__dirname, 'specs'),
  outputDir: path.resolve(__dirname, 'test-results'),

  fullyParallel: false,
  workers: 1,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'dot' : 'list',

  expect: {
    timeout: 10_000,
  },

  use: {
    headless: isCI,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'tauri',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
