import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// 同一份代码两种跑法：
// 1) 独立 Demo：npm run dev（常规 SPA，从 index.html 进入）
// 2) 微前端子应用：打开下方注释的 build.lib，产出 System.register 产物（见 bootstrap.ts / README）
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Vite 5 默认 host=localhost，在 macOS 上只绑定 [::1]（IPv6 loopback），
    // 会导致验收命令里的 127.0.0.1 连不上。显式绑定 IPv6 通配（macOS 默认双栈，
    // IPv4-mapped 一并接受），让 http://localhost:5181 与 http://127.0.0.1:5181 同时可用。
    host: '::',
    // 端口 5181：避开本机 web_system 已占用的 5173 / 8787 / 6000 / 6003（见 README 端口表）。
    // npm run dev 通过 VITE_PORT 显式传入同一值；strictPort 防止被占用时静默漂移到别的端口。
    port: Number(process.env.VITE_PORT || 5181),
    strictPort: true,
    // 同源代理：前端 fetch('/agui') 由 Vite 转发到真实后台 demo-backend（8798，D1-a）。
    // 走同源规避两个已确认的坑：gateway CSP connectSrc 不含 localhost
    // （servers/gateway/src/main.ts:115-122）、CORS allowedHeaders 不含 X-Mcp-Key（同文件 :142）。
    // /agui 目标回落链：DEMO_BACKEND_URL（真实态）→ MOCK_SSE_URL（异常态回 mock）→ 8799（mock 默认）。
    // /api 是三个 widget 子组件的取数接口（D3-B 直连），固定落到 demo-backend 8798。
    proxy: {
      '/agui': {
        target: process.env.DEMO_BACKEND_URL || process.env.MOCK_SSE_URL || 'http://localhost:8799',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.DEMO_BACKEND_URL || 'http://localhost:8798',
        changeOrigin: true,
      },
    },
  },
  // —— 作为 System.register 微前端子应用构建时，取消注释 ——
  // build: {
  //   lib: {
  //     entry: 'src/microfrontend/bootstrap.ts',
  //     formats: ['system'],
  //     fileName: () => 'agent-panel.system.js',
  //   },
  //   rollupOptions: { external: ['vue'] }, // vue 由基座「本地 CDN 种子」提供
  // },
});
