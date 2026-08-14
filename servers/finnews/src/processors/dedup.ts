/** SimHash 文本指纹去重 */
import { createHash } from 'node:crypto';

/** 简易分词：中文 2-gram + 英文单词 */
function tokenize(text: string): string[] {
  const cleaned = text.replace(/[^\w\u4e00-\u9fff]/g, ' ');
  const tokens: string[] = [];

  // 英文单词
  for (const word of cleaned.split(/\s+/)) {
    if (/^[a-zA-Z]+$/.test(word)) {
      tokens.push(word.toLowerCase());
    }
  }

  // 中文 2-gram
  const chinese = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < chinese.length - 1; i++) {
    tokens.push(chinese.slice(i, i + 2));
  }

  return tokens;
}

/** 64 位哈希（MD5 前 16 位 hex） */
function hash64(token: string): bigint {
  const h = createHash('md5').update(token, 'utf8').digest('hex').slice(0, 16);
  return BigInt(`0x${h}`);
}

/** 计算 SimHash 指纹（返回 64 位十六进制字符串） */
export function simhash(text: string, bits = 64): string {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return '0'.repeat(bits / 4);
  }

  // 词频作为权重
  const counter = new Map<string, number>();
  for (const t of tokens) {
    counter.set(t, (counter.get(t) ?? 0) + 1);
  }

  const vec = new Array<number>(bits).fill(0);
  for (const [token, weight] of counter) {
    const h = hash64(token);
    for (let i = 0; i < bits; i++) {
      if ((h & (1n << BigInt(i))) !== 0n) {
        vec[i] += weight;
      } else {
        vec[i] -= weight;
      }
    }
  }

  let fingerprint = 0n;
  for (let i = 0; i < bits; i++) {
    if (vec[i] > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }

  return fingerprint.toString(16).padStart(bits / 4, '0');
}

/** 汉明距离 */
export function hammingDistance(hash1: string, hash2: string): number {
  const n1 = BigInt(`0x${hash1}`);
  const n2 = BigInt(`0x${hash2}`);
  let xor = n1 ^ n2;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** 是否相似（汉明距离 <= threshold，默认 15 ≈ 76% 相似度） */
export function isSimilar(hash1: string, hash2: string, threshold = 15): boolean {
  return hammingDistance(hash1, hash2) <= threshold;
}

/** 相似度（0.0 ~ 1.0） */
export function similarity(hash1: string, hash2: string): number {
  const dist = hammingDistance(hash1, hash2);
  const bits = hash1.length * 4;
  return 1.0 - dist / bits;
}
