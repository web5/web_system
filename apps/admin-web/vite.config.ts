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
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
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
    sourcemap: false,
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
