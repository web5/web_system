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
