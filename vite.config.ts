import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { vibeCafeHead } from './scripts/vibecafe-head';

export default defineConfig({
  plugins: [react(), vibeCafeHead()],
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
});
