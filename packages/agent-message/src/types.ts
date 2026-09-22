/**
 * 结构化回答块类型——三端（portal / admin / 小程序）共用的消息块契约。
 * 来源：portal answer-parse（含 code 块）；渲染层按块类型分别渲染，本包只负责解析产出。
 */
export type AnswerBlock =
  | { t: 'p'; v: string; lead?: boolean }
  | { t: 'h'; v: string }
  | { t: 'ol'; items: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'law'; src: string; v: string }
  | { t: 'code'; lang: string; v: string }
  | { t: 'tcard'; dir: string; main: string; note: string };

/** 内联加粗分段：把 `**text**` 拆成 txt/b 段（渲染层插值，不用 v-html，无 XSS 面） */
export interface BoldSeg {
  b: boolean;
  v: string;
}

/** parseAnswer 的意图上下文 */
export interface ParseOptions {
  /** 意图路由结果（intent.agentId），translate 时优先走翻译卡片 */
  agentId?: string;
  /** 该轮用户提问（推断翻译方向文案用） */
  question?: string;
}
