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
      // 直接指向 shared 源码（绕过 dist 预构建缓存，shared 改动实时生效）
      '@web-system/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0', // 仅 IPv4，避免 IPv6 localhost JS 执行异常
    allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
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

    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    // 使用 terser 压缩，可正确移除生产环境的 console 和 debugger
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    target: 'es2020',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 合并过细的 vendor chunks，避免请求数过多
        manualChunks(id) {
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue') || id.includes('node_modules/vue-router') || id.includes('node_modules/pinia')) {
            return 'vendor-core';
          }
          if (id.includes('node_modules/ant-design-vue') || id.includes('node_modules/@ant-design/icons-vue')) {
            return 'vendor-antd';
          }
          if (id.includes('node_modules/axios') || id.includes('node_modules/dayjs') || id.includes('node_modules/moment')) {
            return 'vendor-utils';
          }
          if (id.includes('node_modules')) {
            return 'vendor-other';
          }
        },
      },
    },
  },
});
