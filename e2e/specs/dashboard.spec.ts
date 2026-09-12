import path from 'node:path';
import { test, expect } from '../fixtures';

test.describe('Dashboard', () => {
  test('displays the dashboard title and captures a screenshot', async ({ tauri }) => {
    const { page } = tauri;

    await page.waitForLoadState('domcontentloaded');

    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('控制台');

    const screenshotPath = path.resolve(__dirname, '..', 'test-results', 'dashboard.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });

  test('shows the application brand in the footer', async ({ tauri }) => {
    const { page } = tauri;
    await page.waitForLoadState('domcontentloaded');

    const footer = page.locator('footer');
    await expect(footer).toContainText('PyForge AI');
  });
});
