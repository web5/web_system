/// <reference types="vite/client" />

// 让 TypeScript 识别 *.vue 单文件组件
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

// 微前端样式穿透：以 ?inline 形式把 CSS 当作字符串引入（Shadow DOM 场景用）
declare module '*.css?inline' {
  const css: string;
  export default css;
}

// 自定义环境变量（也可在 .env 中提供，见 README「环境变量」表）
interface ImportMetaEnv {
  readonly VITE_AGUI_ENDPOINT?: string;
  readonly VITE_MCP_KEY?: string;
  /** widget 产物 URL base，默认 /mf-widgets；里程碑二接入外部子应用 / CDN 时覆写 */
  readonly VITE_WIDGET_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
