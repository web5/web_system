import { ref, computed } from 'vue';
import { renderMarkdown } from '@/lib/markdown';

// ----------------------------------------------------------------------------
// 纯函数：未闭合代码块检测（可单测，不依赖 Vue）
// ----------------------------------------------------------------------------

const FENCE_RE = /^\s*(```|~~~)/;

/** 判断文本当前是否处于「代码块未闭合」状态（按行扫描 fence 开关）。 */
export function isCodeFenceOpen(text: string): boolean {
  const lines = text.split('\n');
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence;
  }
  return inFence;
}

export interface RenderSplit {
  /** 可以安全立即渲染的前缀（已闭合部分） */
  safe: string;
  /** 暂缓渲染的尾部（未闭合块内容），等闭合后再上屏 */
  pending: string;
  /** 是否存在未闭合块 */
  hasUnclosed: boolean;
}

/**
 * 把 buffer 切成「可立即渲染」与「暂缓渲染」两部分。
 * 关键：遇到未闭合的 ``` 时，整段代码块（含其开始 fence）进入 pending，
 * 显示「渲染中…」占位；闭合后整体上屏并一次性高亮，避免半截代码崩渲染。
 */
export function splitRenderable(buffer: string): RenderSplit {
  if (!isCodeFenceOpen(buffer)) {
    return { safe: buffer, pending: '', hasUnclosed: false };
  }
  const lines = buffer.split('\n');
  let openIdx = -1;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      if (!inFence) openIdx = i;
      inFence = !inFence;
    }
  }
  if (openIdx === -1) {
    return { safe: buffer, pending: '', hasUnclosed: false };
  }
  const safe = lines.slice(0, openIdx).join('\n');
  const pending = lines.slice(openIdx).join('\n');
  return { safe, pending, hasUnclosed: true };
}

// ----------------------------------------------------------------------------
// Vue 组合式：token buffer + 增量渲染派生
// ----------------------------------------------------------------------------

export function useStreaming() {
  const raw = ref('');
  const split = computed(() => splitRenderable(raw.value));
  const html = computed(() => renderMarkdown(split.value.safe));
  const isPending = computed(() => split.value.hasUnclosed);
  const pendingText = computed(() => split.value.pending);

  function push(token: string): void {
    raw.value += token;
  }
  function reset(): void {
    raw.value = '';
  }

  return { raw, html, isPending, pendingText, push, reset };
}
