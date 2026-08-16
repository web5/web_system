import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';
import { appVersionDefine, appVersionPlugin } from '../../scripts/vite-app-version.mjs';
import { microFrontendConfig } from '../../scripts/vite-micro-frontend.mjs';

// mode=mf：微前端模块打包（UMD + externals + CSS scope）
// 默认（standalone）：独立 SPA 模式（本地 dev 直跑用）
export default defineConfig(({ mode }) => {
  if (mode === 'mf') {
    return microFrontendConfig({ name: 'portal' });
  }
  return {
    base: '/portal/',
    define: appVersionDefine(),
    plugins: [
      appVersionPlugin(),
      vue(),
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
        '@web-system/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
      proxy: {
        '/materials': { target: 'http://localhost:6000', changeOrigin: true },
        '/api/ai/tts': {
          target: 'http://localhost:6003',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/ai/, '/ai'),
        },
        '/api': { target: 'http://localhost:6000', changeOrigin: true },
      },
    },
    build: {
      sourcemap: false,
      cssCodeSplit: true,
      minify: 'terser',
      terserOptions: { compress: { drop_console: true, drop_debugger: true } },
      target: 'es2020',
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
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
  };
});
