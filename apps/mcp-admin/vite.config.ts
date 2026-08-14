import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  base: '/mcp-admin/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5175,
    host: '0.0.0.0',
    proxy: {
      // 本地开发直连 mcp-gateway（生产走 gateway 的 /api/mcp 代理转发）
      '/api/mcp': {
        target: 'http://localhost:6006',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/mcp/, '/api'),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
