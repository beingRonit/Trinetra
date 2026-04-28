import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const publicBase = env.VITE_PUBLIC_BASE || '/';
  return {
    base: publicBase,
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify(env.VITE_CLERK_PUBLISHABLE_KEY || ''),
      'process.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/auth': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
        '/register': 'http://127.0.0.1:8000',
        '/analyze-image': 'http://127.0.0.1:8000',
        '/ingest': 'http://127.0.0.1:8000',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
