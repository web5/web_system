import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { appVersionDefine, appVersionPlugin } from '../../scripts/vite-app-version.mjs';

// 基座 Shell 的 vite 配置。
// vue/vue-router/pinia/antd/axios/dayjs 全部打包进 shell.js（不 external），
// shell main.ts 启动时挂到 window.__SHARED__，模块 external 后从这里取（同一份实例）。
// 这样基座自包含，不依赖 externals 预加载顺序，也不需要 importmap。
export default defineConfig({
  base: '/shell/',
  define: appVersionDefine(),
  plugins: [appVersionPlugin(), vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@web-system/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@web-system/shell-loader': resolve(__dirname, '../../packages/shell-loader/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    host: '0.0.0.0',
    proxy: {
      '/api': { target: 'http://localhost:6000', changeOrigin: true },
      '/static': { target: 'http://localhost:6000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssCodeSplit: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks(id) {
          if (id.includes('node_modules/ant-design-vue') || id.includes('node_modules/@ant-design/icons-vue')) return 'vendor-antd';
          if (id.includes('node_modules/vue') || id.includes('node_modules/@vue') || id.includes('node_modules/vue-router') || id.includes('node_modules/pinia')) return 'vendor-vue';
        },
      },
    },
  },
});
