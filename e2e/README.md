# PyForge AI — Tauri E2E Tests

This directory contains end-to-end tests for the Tauri desktop application using
[Playwright](https://playwright.dev/) connected to the built app binary.

## Prerequisites

1. A working Rust toolchain (`rustc`, `cargo`).
2. Platform build dependencies for Tauri (MSVC on Windows, Xcode on macOS,
   `libwebkit2gtk-4.1-dev` on Linux).
3. Node.js dependencies installed at the repository root:
   ```bash
   npm install
   ```
4. Playwright Chromium browser binaries:
   ```bash
   npx playwright install chromium
   ```

## Build the app

E2E tests run against the **unbundled release binary** produced by Tauri. Build
it first:

```bash
npm run tauri:build:no-bundle
```

This writes the binary to `src-tauri/target/release/`:

- Windows: `pyforge-ai.exe`
- macOS: `pyforge-ai`
- Linux: `pyforge-ai`

## Run tests

```bash
# Local interactive run (headed when CI is not set)
npm run test:e2e

# CI-friendly dot reporter, headless mode enabled via CI=true
npm run test:e2e:ci

# Debug mode with Playwright inspector
npm run test:e2e:debug
```

## How it works

`fixtures.ts` exports a custom Playwright `test` fixture that:

1. Locates the built binary in `src-tauri/target/release/`.
2. Spawns it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
   so the webview exposes a Chrome DevTools Protocol endpoint.
3. Connects Playwright to that endpoint with `chromium.connectOverCDP()`.
4. Provides `tauri.page` for DOM assertions and automatically tears down the
   process after each test.

Because the browser is already running, Playwright options such as `headless`,
`screenshot`, `video`, and `trace` configured in `playwright.config.ts` only
apply to the test metadata layer; screenshots inside tests are captured
explicitly with `page.screenshot()`.

## Troubleshooting

- **Binary not found**: ensure `npm run tauri:build:no-bundle` succeeded and the
  expected binary exists in `src-tauri/target/release/`.
- **CDP connection timeout**: make sure no other process is using port `9222`,
  or pass a different `remoteDebuggingPort` to `launchTauriApp()`.
- **WebView2 not available on Windows**: install the
  [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
