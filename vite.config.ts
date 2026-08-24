import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isE2E = env.VITE_E2E_FIREBASE_EMULATOR === 'true';
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      plugins: [
        isE2E && {
          name: 'e2e-local-only-html',
          transformIndexHtml(html: string) {
            return html
              .replace(
                /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
                '<meta http-equiv="Content-Security-Policy" content="default-src \'self\' data: blob: \'unsafe-inline\' \'unsafe-eval\'; connect-src \'self\' http://127.0.0.1:8089 http://127.0.0.1:9099 ws://127.0.0.1:*;">'
              )
              .replace(/\s*<link[^>]+fonts\.googleapis\.com[^>]*>/gi, '')
              .replace(/\s*<link[^>]+cdnjs\.cloudflare\.com[^>]*>/gi, '');
          },
        },
        react(),
        tailwindcss(),
      ].filter(Boolean),
      define: {},
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
