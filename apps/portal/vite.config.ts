import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    vue(),
    // 生成 .gz 文件，Nginx 配合 gzip_static on 使用（避免每次请求都压缩）
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      level: 6,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // TTS 语音合成 — 直接代理到 AI 服务，绕过 Gateway 避免二进制被 JSON 包装
      '/api/ai/tts': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ai/, '/ai'),
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // 上传文件静态资源 — 代理到 Gateway（再由 Gateway 转发到 user-service）
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    // 移除 console 和 debugger（生产环境）
    minify: 'esbuild',
    target: 'es2015',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 优化 chunk 拆分 - 细粒度拆分，便于浏览器并行下载
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) {
            return 'vendor-vue';
          }
          if (id.includes('node_modules/ant-design-vue') || id.includes('node_modules/@ant-design/icons-vue')) {
            return 'vendor-antd';
          }
          // 进一步拆分大型第三方库，提升并行加载
          if (id.includes('node_modules/vue-router')) {
            return 'vendor-router';
          }
          if (id.includes('node_modules/pinia')) {
            return 'vendor-pinia';
          }
          if (id.includes('node_modules/axios')) {
            return 'vendor-axios';
          }
          if (id.includes('node_modules/dayjs') || id.includes('node_modules/moment')) {
            return 'vendor-dayjs';
          }
          if (id.includes('node_modules')) {
            return 'vendor-other';
          }
        },
      },
    },
  },
});
