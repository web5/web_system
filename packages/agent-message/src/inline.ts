import type { BoldSeg } from './types';

/** 内联加粗分段：把 `**text**` 拆成 txt/b 段；行内 `code` 剥反引号保留文本（轻量，不引 markdown 库、不渲染等宽） */
export function boldSegs(v: string): BoldSeg[] {
  const cleaned = (v || '').replace(/`([^`]+)`/g, '$1');
  const parts = cleaned.split(/\*\*(.+?)\*\*/g);
  return parts
    .filter((s) => s !== '')
    .map((s, i) => {
      const isBold = i % 2 === 1;
      // 未配对的残余 ** 直接剥掉
      return { b: isBold, v: isBold ? s : s.replace(/\*\*/g, '') };
    })
    .filter((s) => s.v !== '');
}

/** 剥 markdown 行内标记（加粗 / 反引号），列表项、法条等不渲染加粗时用 */
export function stripInline(v: string): string {
  return (v || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '').replace(/`([^`]+)`/g, '$1');
}
