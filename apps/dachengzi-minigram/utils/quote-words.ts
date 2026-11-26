/**
 * 今日一句所在课文的词表缓存（首页点词查释义用）
 *
 * 为什么需要：今日一句的缓存行只有 { cn, en, book?, lessonId? }，没有词表；
 * 要在首页区分「课文生词（可点、有释义）」与「课外表词（纯文本）」，必须回查课文详情。
 * 同一课可能被反复取到（句池按天轮换、用户当天多次进首页），故按 book:lessonId 落本地缓存。
 *
 * 口径：
 *  - TTL 7 天：词表属于教材静态数据，长 TTL 足够；过期后静默重拉，失败沿用不了也不报错。
 *  - 单 key 存整个 map（`nce_words_cache_v1`），最多保留 40 课，避免 storage key 爆炸。
 *  - 任何异常（storage 读失败 / 脏结构）一律当「无缓存」，绝不抛到页面。
 */
import type { NceWord } from '../services/nce';

const KEY = 'nce_words_cache_v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 最多保留的课数（超出按写入时间淘汰最旧） */
const MAX_ENTRIES = 40;

interface CacheEntry {
  /** 写入时间戳（ms） */
  at: number;
  words: NceWord[];
}
type CacheStore = Record<string, CacheEntry>;

function readStore(): CacheStore {
  try {
    const raw = wx.getStorageSync(KEY);
    if (!raw || typeof raw !== 'object') return {};
    return raw as CacheStore;
  } catch {
    return {};
  }
}

function cacheKey(book: string, lessonId: number): string {
  return `${book}:${lessonId}`;
}

/** 读词表缓存；未命中 / 过期 / 结构非法 → null（调用方自行回源） */
export function readWordsCache(book: string, lessonId: number): NceWord[] | null {
  if (!book || !Number.isInteger(lessonId)) return null;
  const entry = readStore()[cacheKey(book, lessonId)];
  if (!entry || !Array.isArray(entry.words)) return null;
  const at = Number(entry.at);
  if (!Number.isFinite(at) || Date.now() - at > TTL_MS) return null;
  return entry.words;
}

/** 写词表缓存（写入失败静默：缓存只是优化，不影响点词功能本身） */
export function writeWordsCache(book: string, lessonId: number, words: NceWord[]): void {
  if (!book || !Number.isInteger(lessonId) || !Array.isArray(words)) return;
  try {
    const store = readStore();
    store[cacheKey(book, lessonId)] = { at: Date.now(), words };
    const keys = Object.keys(store);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => Number(store[a] && store[a].at) - Number(store[b] && store[b].at))
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => { delete store[k]; });
    }
    wx.setStorageSync(KEY, store);
  } catch {
    /* 缓存失败不影响主流程 */
  }
}
