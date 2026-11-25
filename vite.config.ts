import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { vibeCafeHead } from './scripts/vibecafe-head';

export default defineConfig(({ mode }) => {
  const token = loadEnv(mode, process.cwd(), 'WEBMCP_').WEBMCP_ORIGIN_TRIAL_TOKEN?.trim();
  return {
    plugins: [
      react(),
      vibeCafeHead(),
      {
        name: 'webmcp-origin-trial',
        transformIndexHtml: () => token
          ? [{ tag: 'meta', attrs: { 'http-equiv': 'origin-trial', content: token }, injectTo: 'head' }]
          : [],
      },
    ],
    server: { host: '127.0.0.1', port: 4318, strictPort: true },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
