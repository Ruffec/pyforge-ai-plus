import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';
import { readFileSync } from 'fs';

// 单一版本来源：package.json 的 version 字段，注入前端 __APP_VERSION__ 全局常量
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as {
  version: string;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    ...tailwindcss(),
    ...(mode === 'analyze' ? [visualizer({ open: false, filename: 'design/artifacts/stats.html' })] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vite options tailored for Tauri development and only applied using `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: true,
  },
  // 3. Make env variables available to the client prefixed with these strings
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri on Windows uses WebView2 (Chrome-based)
    target: 'chrome105',
    minify: 'esbuild' as const,
  },
}));
