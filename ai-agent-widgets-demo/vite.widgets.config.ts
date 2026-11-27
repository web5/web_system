// ----------------------------------------------------------------------------
// widget 子应用构建配置：产出真正的 System.register 格式产物
// ----------------------------------------------------------------------------
// 运行 `npm run build:widgets`（由 scripts/build-widgets.mjs 逐个子应用调用本配置），
// 输出到 public/mf-widgets/<app>.system.js，Vite dev / build 均可通过
// /mf-widgets/<app>.system.js 直接访问（publicDir 会原样拷贝进 dist）。
//
// * formats: ['system']        -> rollup 输出 System.register([...deps], declare)
// * external: ['vue']          -> vue 由基座 System.set('vue', Vue) 提供，产物不打包第二份
// * external: ['agui-bus']     -> 同一招透传全局 EventTarget 单例
// * minify: false              -> 保留 System.register 可读性，便于 curl / 肉眼验收
// ----------------------------------------------------------------------------
import { defineConfig, type UserConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export const WIDGET_NAMES = ['poll', 'chart', 'form'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

export function widgetConfig(name: WidgetName): UserConfig {
  return {
    plugins: [vue()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    // outDir 位于 public/ 内，关掉 publicDir 拷贝，避免 Vite 警告与自递归复制
    publicDir: false,
    build: {
      outDir: 'public/mf-widgets',
      emptyOutDir: false, // 多个子应用依次构建，不能互相清空
      cssCodeSplit: false,
      minify: false,
      lib: {
        entry: `src/widgets/${name}.ts`,
        formats: ['system'],
        fileName: () => `${name}.system.js`,
      },
      rollupOptions: {
        external: ['vue', 'agui-bus'],
      },
    },
  };
}

export default defineConfig(widgetConfig((process.env.VITE_WIDGET || 'poll') as WidgetName));
