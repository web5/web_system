import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import viteCompression from 'vite-plugin-compression';
import { appVersionDefine, appVersionPlugin } from '../../scripts/vite-app-version.mjs';
import { publicAssetDefine } from '../../scripts/vite-public-assets.mjs';
import { microFrontendConfig } from '../../scripts/vite-micro-frontend.mjs';

// mode=mf：微前端模块打包（UMD + externals + CSS scope）
// 默认（standalone）：独立 SPA 模式（本地 dev 直跑用）
export default defineConfig(({ mode }) => {
  if (mode === 'mf') {
    return microFrontendConfig({ name: 'portal' });
  }
  return {
    base: '/portal/',
    // 版本常量 + 公共静态资源前缀（/static/cdn/pub/，见 assets/shared-public/README.md）
    define: { ...appVersionDefine(), ...publicAssetDefine() },
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
        '@web-system/agent-message': resolve(__dirname, '../../packages/agent-message/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
      proxy: {
        // ⚠️ /materials 已迁至 /static/cdn/pub/materials/（由 gateway 托管），这里只保留 /static 代理，
        //    本地 dev 与生产同源：都从 gateway 拉 CDN 目录下的资源，消灭两份拷贝漂移。
        '/static': { target: 'http://localhost:6000', changeOrigin: true },
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
