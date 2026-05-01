import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const dappTarget = env.VITE_DAPP_API_URL || 'http://127.0.0.1:3004';
  const pipelineTarget = env.VITE_PIPELINE_API_URL || 'http://127.0.0.1:8003';
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
          target: dappTarget,
          changeOrigin: true,
        },
        '/api/dashboard': {
          target: dappTarget,
          changeOrigin: true,
        },
        '/assets': {
          target: dappTarget,
          changeOrigin: true,
        },
        '/takedown': {
          target: dappTarget,
          changeOrigin: true,
        },
        '/api': {
          target: pipelineTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
        '/register': pipelineTarget,
        '/analyze-image': pipelineTarget,
        '/ingest': pipelineTarget,
        '/login': dappTarget,
        '/signup': dappTarget,
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
