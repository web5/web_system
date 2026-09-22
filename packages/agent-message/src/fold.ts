import type { AnswerBlock } from './types';

/**
 * 折叠截断：按块边界取前若干块（累计约 90 字止），绝不把法条 / 列表 / 代码块切一半。
 * 超长代码块（> 90 字）整块不可切 → 不进折叠预览，展开后完整可见。
 */
export function foldCut(blocks: AnswerBlock[]): AnswerBlock[] {
  let n = 0;
  const out: AnswerBlock[] = [];
  for (const b of blocks) {
    if (b.t === 'code' && b.v.length > 90) break;
    out.push(b);
    if (b.t === 'p' || b.t === 'ol' || b.t === 'ul' || b.t === 'law' || b.t === 'code') {
      n += b.t === 'p' || b.t === 'law' || b.t === 'code' ? b.v.length : b.items.join('').length;
    }
    if (n >= 90) break;
  }
  return out;
}

/** 纯文本字数（折叠阈值判定用；口径 = p + code，触发与截断同源；不含 tcard/列表/法条） */
export function plainLength(blocks: AnswerBlock[]): number {
  return blocks
    .filter((b): b is Extract<AnswerBlock, { t: 'p' } | { t: 'code' }> => b.t === 'p' || b.t === 'code')
    .map((b) => b.v)
    .join('')
    .length;
}
