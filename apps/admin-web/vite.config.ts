import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { resolve } from 'path';

export default defineConfig({
  base: '/admin/',
  plugins: [vue(), vueJsx()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      // 直接指向 shared 源码（绕过 dist 预构建缓存，shared 改动实时生效）
      '@web-system/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5174,
    host: true, // 同时监听 IPv4/IPv6，兼容 Whistle 代理
    allowedHosts: ['local.kedouai.com', 'localhost', '127.0.0.1'],
    // SPA 回退 + 访问根路径时重定向到 /admin/
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        // 根路径 → 重定向到 /admin/
        if (url === '/') {
          res.writeHead(301, { Location: '/admin/' });
          res.end();
          return;
        }
        // /admin 不带斜杠 → 补斜杠重定向
        if (url === '/admin') {
          res.writeHead(301, { Location: '/admin/' });
          res.end();
          return;
        }
        // SPA 回退：/admin 开头的路径如果没有文件后缀（非静态资源），返回 index.html
        if (url.startsWith('/admin') && !url.includes('.')) {
          req.url = '/';
        }
        next();
      });
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },

      '/materials': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 关键：关闭 chunk 文件名 hash 函数中的某些默认行为，让 vite 自己优化
        // ECharts 不打入全局 vendor，而是由 Dashboard.vue 动态导入时拆为独立 chunk
        manualChunks(id) {
          // 框架核心
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue')) {
            return 'vendor-vue';
          }
          // Ant Design Vue 组件库（admin 页面必备，初始化即加载）
          if (id.includes('node_modules/ant-design-vue') || id.includes('node_modules/@ant-design/icons-vue')) {
            return 'vendor-antd';
          }
          // 其他轻量依赖（axios, pinia, dayjs 等）
          if (id.includes('node_modules')) {
            return 'vendor-other';
          }
          // ECharts 与 vue-echarts 留给 Rollup 自动按路由切分（仅 Dashboard.vue 引用）
        },
      },
    },
  },
});
