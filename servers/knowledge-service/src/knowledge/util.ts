import { createHash } from 'crypto';

/** 内容校验和（32 位 hex；幂等去重用） */
export function sha1hex(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

/**
 * 简易文本分块：先按空行/句号切段，再贪心合并到 maxChars。
 * 段长 > maxChars 时按字符硬切。学习级实现，够用不引入重型分块库。
 */
export function chunkText(
  text: string,
  maxChars = 800,
  _overlap = 120,
): string[] {
  const normalized = (text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const rawParagraphs = normalized.split(/\n{2,}/);
  const paragraphs: string[] = [];
  for (const p of rawParagraphs) {
    const segs = p.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
    for (const s of segs) paragraphs.push(s.trim());
  }
  const cleaned = paragraphs.filter(Boolean);
  if (!cleaned.length) return [];

  const chunks: string[] = [];
  let buffer = '';
  for (const para of cleaned) {
    if (para.length > maxChars) {
      if (buffer) {
        chunks.push(buffer);
        buffer = '';
      }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if (buffer.length + para.length + 1 > maxChars) {
      chunks.push(buffer);
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n${para}` : para;
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/** 余弦相似度（向量已归一则等价点积） */
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
