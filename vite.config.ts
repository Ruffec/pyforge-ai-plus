import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
