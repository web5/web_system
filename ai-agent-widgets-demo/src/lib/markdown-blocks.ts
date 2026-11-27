// ----------------------------------------------------------------------------
// 🔴 流式增量渲染的核心：把「整段 HTML 重渲染」改成「稳定 block 序列」
// ----------------------------------------------------------------------------
// 为什么必须这么做：
//   原来的 StreamingMarkdown 对 safe 前缀整段 `v-html="html"`，每来一个 token
//   都会把整棵 DOM 子树替换掉。若 markdown 中间挂着一个由 System.import 动态
//   载入的子应用，它会在下一帧被连根拔起 —— 输入框内容、选中态、Vue 实例全丢。
//
// 解法：
//   1) 在 markdown **源码层**按 widget fence 切成 block 序列（不解析 HTML）；
//   2) 每个 block 一个稳定 id：文本块用「起始字符偏移」，widget 块用「app + 出现序号」；
//   3) Vue 模板 v-for + :key；文本块 v-html，widget 块是独立组件 WidgetSlot；
//   4) 后续 token 只让「最后一个文本块」的 src 变化，前面的 widget 组件节点不重建。
// ----------------------------------------------------------------------------

import { isWidgetFence } from './markdown';
import { parseWidgetSpec, type WidgetSpec, type WidgetApp } from './widget-protocol';

export type MdBlock =
  | { id: string; kind: 'md'; src: string }
  | { id: string; kind: 'widget'; spec: WidgetSpec; raw: string }
  | { id: string; kind: 'widget-invalid'; raw: string };

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^(\s{0,3})(`{3,}|~{3,})\s*$/;

interface LineInfo {
  text: string;
  start: number; // 该行首字符在原串中的偏移
  end: number; // 该行末（不含 \n）之后的偏移
}

function linesWithOffsets(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let start = 0;
  for (const line of text.split('\n')) {
    out.push({ text: line, start, end: start + line.length });
    start += line.length + 1; // +1 for '\n'
  }
  return out;
}

/**
 * 把一段「已闭合」的 markdown 切成稳定 block 序列。
 * 纯函数、不抛错：半截 JSON / 非法 JSON / 非白名单 app 都变成 widget-invalid 占位块。
 */
export function splitWidgetBlocks(text: string): MdBlock[] {
  const lines = linesWithOffsets(text);
  const blocks: MdBlock[] = [];
  const occurrence = new Map<WidgetApp, number>();
  const invalidOccurrence = { n: 0 };

  let segmentStart = 0;
  let plainFence: { char: string; len: number } | null = null;

  const flushMd = (until: number): void => {
    const src = text.slice(segmentStart, until);
    if (src.trim().length > 0) {
      blocks.push({ id: `m:${segmentStart}`, kind: 'md', src });
    }
    segmentStart = until;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (plainFence) {
      const m = FENCE_CLOSE.exec(line.text);
      if (m && m[2][0] === plainFence.char && m[2].length >= plainFence.len) {
        plainFence = null;
      }
      continue; // 普通代码块整体留在 md 段内，交给 markdown-it + hljs
    }

    const open = FENCE_OPEN.exec(line.text);
    if (!open) continue;

    const marker = open[2];
    const info = open[3].trim();
    if (!isWidgetFence(info)) {
      plainFence = { char: marker[0], len: marker.length };
      continue;
    }

    // —— 命中 ```widget —— 找它的闭合 fence
    let closeIdx = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const cm = FENCE_CLOSE.exec(lines[j].text);
      if (cm && cm[2][0] === marker[0] && cm[2].length >= marker.length) {
        closeIdx = j;
        break;
      }
    }

    flushMd(line.start);

    if (closeIdx === -1) {
      // 未闭合（流式中半截）：占位块，等待后续 token
      const raw = lines.slice(i + 1).map((l) => l.text).join('\n');
      blocks.push({
        id: `w:pending:${line.start}:${++invalidOccurrence.n}`,
        kind: 'widget-invalid',
        raw,
      });
      return blocks; // 后面全部属于未闭合块，不再切
    }

    const raw = lines.slice(i + 1, closeIdx).map((l) => l.text).join('\n');
    const spec = parseWidgetSpec(raw);
    if (spec) {
      const n = (occurrence.get(spec.app) ?? 0) + 1;
      occurrence.set(spec.app, n);
      blocks.push({ id: `w:${spec.app}:${n}`, kind: 'widget', spec, raw });
    } else {
      blocks.push({
        id: `w:invalid:${line.start}:${++invalidOccurrence.n}`,
        kind: 'widget-invalid',
        raw,
      });
    }

    // 下一段 md 从闭合 fence 之后开始（+1 跳过换行）
    segmentStart = Math.min(lines[closeIdx].end + 1, text.length);
    i = closeIdx;
  }

  flushMd(text.length);
  return blocks;
}

function sameContent(a: MdBlock, b: MdBlock): boolean {
  if (a.kind === 'md' && b.kind === 'md') return a.src === b.src;
  if (a.kind === 'widget' && b.kind === 'widget') return a.raw === b.raw;
  if (a.kind === 'widget-invalid' && b.kind === 'widget-invalid') return a.raw === b.raw;
  return false;
}

/**
 * 复用未变化 block 的**对象引用**：Vue 看到完全相同的 props 引用，
 * 连子组件的 render 都不会重跑，widget 的 DOM / Vue 实例 100% 不被触碰。
 * 只有「最后一个文本块」因为 src 增长会拿到新对象，重绘范围被锁死在这一块。
 */
export function reconcileBlocks(text: string, prev: MdBlock[]): MdBlock[] {
  const fresh = splitWidgetBlocks(text);
  const byId = new Map(prev.map((b) => [b.id, b]));
  return fresh.map((b) => {
    const old = byId.get(b.id);
    return old && old.kind === b.kind && sameContent(old, b) ? old : b;
  });
}

/** 未闭合尾部是不是一个 widget 声明（用于流式阶段显示「检测到 widget 声明」）。 */
export function isWidgetPending(pending: string): boolean {
  const first = pending.split('\n')[0] ?? '';
  return isWidgetFence(first.replace(/^\s*(`{3,}|~{3,})/, ''));
}
