import { test as base, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

export interface TauriApp {
  /** Spawned Tauri desktop process. */
  process: ChildProcess;
  /** Playwright browser connected to the webview via CDP. */
  browser: Browser;
  /** Default browser context exposed by the webview. */
  context: BrowserContext;
  /** First page of the Tauri window. */
  page: Page;
  /** Kill the app and close the Playwright connection. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Fixed remote-debugging port used to connect to WebView2/Chromium. */
  remoteDebuggingPort?: number;
  /** Maximum time to wait for the binary to expose its CDP endpoint. */
  timeout?: number;
}

const ROOT = path.resolve(__dirname, '..');

function findBuiltBinary(): string {
  const releaseDir = path.join(ROOT, 'src-tauri', 'target', 'release');

  const candidates: string[] = (() => {
    switch (process.platform) {
      case 'win32':
        return ['pyforge-ai.exe', 'PyForge AI.exe'];
      case 'darwin':
        return ['pyforge-ai'];
      case 'linux':
        return ['pyforge-ai'];
      default:
        throw new Error(`Unsupported platform for Tauri E2E tests: ${process.platform}`);
    }
  })();

  for (const candidate of candidates) {
    const binaryPath = path.join(releaseDir, candidate);
    if (fs.existsSync(binaryPath)) {
      return binaryPath;
    }
  }

  throw new Error(
    `Built Tauri binary not found in ${releaseDir}. ` +
      `Candidates: ${candidates.join(', ')}. ` +
      `Run "npm run tauri:build:no-bundle" first.`
  );
}

/**
 * Launch the built Tauri application and connect Playwright to its webview.
 *
 * This relies on WebView2/Chromium remote debugging. On Windows the helper
 * injects `--remote-debugging-port` via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.
 */
export async function launchTauriApp(options: LaunchOptions = {}): Promise<TauriApp> {
  const binaryPath = findBuiltBinary();
  const remoteDebuggingPort = options.remoteDebuggingPort ?? 9222;
  const timeout = options.timeout ?? 30_000;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${remoteDebuggingPort}`,
  };

  const proc = spawn(binaryPath, [], {
    env,
    stdio: 'pipe',
    detached: false,
  });

  let browser: Browser | undefined;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${remoteDebuggingPort}`);
      break;
    } catch {
      await setTimeout(500);
    }
  }

  if (!browser) {
    proc.kill();
    throw new Error(
      `Unable to connect to Tauri app on CDP port ${remoteDebuggingPort} within ${timeout}ms.`
    );
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    process: proc,
    browser,
    context,
    page,
    async close() {
      try {
        await browser.close();
      } catch {
        // Ignore cleanup errors.
      }
      proc.kill('SIGTERM');
    },
  };
}

/**
 * Playwright test fixture that automatically starts and stops the Tauri app.
 *
 * Tests should import `test` and `expect` from this file instead of
 * `@playwright/test` directly.
 */
export const test = base.extend<{ tauri: TauriApp }>({
  tauri: async (_, use) => {
    const app = await launchTauriApp();
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

export { expect };
