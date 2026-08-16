import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { resolve } from 'path';
import { appVersionDefine, appVersionPlugin } from '../../scripts/vite-app-version.mjs';
import { microFrontendConfig } from '../../scripts/vite-micro-frontend.mjs';

export default defineConfig(({ mode }) => {
  if (mode === 'mf') {
    return microFrontendConfig({ name: 'admin' });
  }
  return {
    base: '/admin/',
    define: appVersionDefine(),
    plugins: [
      appVersionPlugin(),
      vue(),
      vueJsx(),
      {
        name: 'admin-base-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            if (url === '/') { res.writeHead(301, { Location: '/admin/' }); res.end(); return; }
            if (url === '/admin') { res.writeHead(301, { Location: '/admin/' }); res.end(); return; }
            // SPA fallback：/admin/xxx（无扩展名）返回 index.html。
            // 排除 vite 虚拟模块（/admin/@vite/client、/admin/@id/...），否则会被误改成 index.html
            // 导致 @vite/client 加载成 HTML、module 链断裂报 404。
            if (url.startsWith('/admin') && !url.includes('.') && !url.includes('/@')) {
              req.url = '/admin/index.html';
            }
            next();
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@web-system/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      },
    },
    server: {
      port: 5174,
      host: '0.0.0.0',
      allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
      proxy: {
        '/api': { target: 'http://localhost:6000', changeOrigin: true },
        '/materials': { target: 'http://localhost:6000', changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: 'hidden',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) return 'vendor-vue';
            if (id.includes('node_modules/ant-design-vue') || id.includes('node_modules/@ant-design/icons-vue')) return 'vendor-antd';
            if (id.includes('node_modules')) return 'vendor-other';
          },
        },
      },
    },
  };
});
