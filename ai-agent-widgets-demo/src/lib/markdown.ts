import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import {
  WIDGET_PENDING_HTML,
  parseWidgetSpec,
  slotHtml,
  type WidgetSpec,
} from './widget-protocol';

export type { WidgetSpec } from './widget-protocol';

/**
 * 全局唯一的 markdown-it 实例（模块级单例，避免每次渲染重建）。
 * - html:false 防 XSS（markdown 正文里的裸 HTML 一律转义）
 * - highlight 用 highlight.js 对「已闭合」代码块做语法高亮
 * - **自定义 fence rule**：info === 'widget' 时不渲染成代码块，而是输出
 *   `<div class="mf-slot" data-app="..." data-props="..."></div>` 挂载点，
 *   由基座 WidgetSlot 通过 System.import 运行时挂载可交互子应用。
 */
export const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs
          .highlight(code, { language: lang, ignoreIllegals: true })
          .value;
      } catch {
        /* 忽略非法高亮 */
      }
    }
    return '';
  },
});

// 保存 markdown-it 自带 fence 渲染器：普通 fence（```ts / ```json / ~~~）仍走
// highlight.js，行为与改造前完全一致。
const defaultFence = md.renderer.rules.fence!;

/** info 首词是否为 widget（允许 ```widget 或 ```widget foo 这类带参数的写法）。 */
export function isWidgetFence(info: string): boolean {
  return info.trim().split(/\s+/)[0] === 'widget';
}

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!isWidgetFence(token.info)) {
    return defaultFence(tokens, idx, options, env, self);
  }
  const spec = parseWidgetSpec(token.content);
  // 半截 JSON / 非法 JSON / 非白名单 app：统一渲染「加载中」占位，绝不抛错、绝不动态 import。
  if (!spec) return WIDGET_PENDING_HTML + '\n';
  return slotHtml(spec) + '\n';
};

export function renderMarkdown(src: string): string {
  return md.render(src);
}

/** 单独渲染一个 widget 声明（供测试 / 静态文档渲染使用）。 */
export function renderWidgetSpec(spec: WidgetSpec): string {
  return slotHtml(spec);
}
