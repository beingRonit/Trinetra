import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
        },
        '/api/dashboard': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
        },
        '/assets': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
        },
        '/takedown': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://127.0.0.1:8003',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/register': 'http://127.0.0.1:8003',
        '/analyze-image': 'http://127.0.0.1:8003',
        '/ingest': 'http://127.0.0.1:8003',
        '/login': 'http://127.0.0.1:3003',
        '/signup': 'http://127.0.0.1:3003',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
