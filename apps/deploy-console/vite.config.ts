import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue(), vueJsx()],
  base: '/console/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // 共享 UI 组件的**源码**直引：@web-system/ui 以 dist 消费且流水线不构建它，
      // 组件若走 dist 就得给它新增构建步骤（会制造"改了不生效"）。
      // 指向源码后由本应用自己的 vite 编译，零额外构建环节。
      '@web-system/ui/components': resolve(__dirname, '../../packages/ui/src/components'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/console/api': {
        target: 'http://localhost:6200',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/console/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // echarts 体积较大，单独分包：避免打进引用它的页面 chunk，
        // 便于长效缓存，也不拖慢不依赖图表的页面首屏。
        manualChunks(id: string) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) {
            return 'echarts'
          }
        },
      },
    },
  },
})
