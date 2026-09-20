import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { viteExternalsPlugin } from 'vite-plugin-externals';
import { appVersionDefine, appVersionPlugin } from '../../scripts/vite-app-version.mjs';

// 基座 Shell 的 vite 配置。
// vue/vue-router/pinia/antd/axios/dayjs 通过 CDN 加载（index.html script 标签，挂全局），
// 由 viteExternalsPlugin 把 import 映射到全局变量，shell 不再打包这些库（体积大幅减小）。
// pinia CDN 为 vue-demi iife，需先加载 vue-demi 全局（见 index.html）。
// @ant-design/icons-vue 无 UMD CDN 版，仍由 shell 打包。
// shell main.ts 启动时把全局依赖挂到 window.__SHARED__，微前端模块 external 后从这里取（同一份实例）。

/**
 * 产物 base —— **按版本加载**（用户 2026-09-15：基座不做覆盖式发布）。
 *
 * 发布流水线构建时注入 `COMMIT_ID`（= `<流水线 key>/<commit>`，如 `shell-local/ba5deba`），
 * 产物投到 `static/modules/shell/<COMMIT_ID>/`，因此资源 base 必须指向该版本目录，
 * 否则 index.html 里的 `/shell/assets/*` 会打到旧目录（版本切换后资源 404）。
 * 本地/未注入版本标识时退回历史固定 base `/shell/`。
 *
 * 与微前端模块的 `resolveMfBase()` 同构：都由「产品线/版本」两级组成。
 */
const releaseTag = process.env.RELEASE_TAG || process.env.COMMIT_ID || '';
const shellBase = releaseTag ? `/static/modules/shell/${releaseTag}/` : '/shell/';

export default defineConfig({
  base: shellBase,
  define: appVersionDefine(),
  plugins: [
    appVersionPlugin(),
    vue(),
    // 外部依赖 → 全局变量（index.html 通过 CDN 加载对应 UMD）
    viteExternalsPlugin({
      vue: 'Vue',
      'vue-router': 'VueRouter',
      pinia: 'Pinia',
      'ant-design-vue': 'antd',
      axios: 'axios',
      dayjs: 'dayjs',
    }),
  ],
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
          if (id.includes('node_modules/@ant-design/icons-vue')) return 'vendor-icons';
        },
      },
    },
  },
});
