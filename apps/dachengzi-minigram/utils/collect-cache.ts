/**
 * 收藏态本地缓存（2026-11-27 · D7「收藏态跨界面回查」）
 *
 * 要解决的问题（用户已踩到）：
 *   收藏成功后页面只把一个会话内的 boolean 置 true，**关掉词卡 / 抽屉再打开就变回「☆ 收藏」**。
 *   用户看到的是「我明明收藏过了，按钮怎么又让我收藏」。
 *
 * 为什么不能「打开时就查一次接口」：
 *   后端 `GET /api/glossary` 只有**分页列表 + keyword 模糊匹配**（`servers/user-service/src/glossary`），
 *   **没有**「这个词 / 这句话是否已收藏」的存在性接口：
 *     · keyword 是 `enMain ILike('%kw%')` 模糊匹配，`the` / `is` 这类词会命中一堆行；
 *     · 结果按 createdAt 倒序分页（默认 20 条），精确命中项可能落在第 2 页之后 → 会得出
 *       「没收藏过」的**假否定**，比现在的「全都显示未收藏」更糟（假否定会让用户重复收藏）。
 *   ⇒ 本轮不做静默回查，走**纯本地缓存**做初始态，另加一条**写请求纠正**兜底（见下）。
 *
 * 🔴 缓存失效兜底（必须保留，否则这就是个只增不减的假状态）：
 *   用户在「我的收藏」页删了一条，本地缓存无从得知 → 再打开词卡会显示 ✓ 已收藏。
 *   所以两页的收藏入口**从不「看到已收藏就直接 return」**：点一下仍然走真实写请求
 *   （`collectGlossary` 对已存在条目返回 `existed:true`，幂等不重复写入）。真正的语义是
 *   「UI 显示的已收藏，点一下就会与服务器对齐」—— 删掉的条目会被这次写请求**重新建回来**，
 *   于是状态不再撒谎。
 *   ⇒ 缓存只当**初值**，绝不当**唯一真源**：不要在调用点加 `if (cached) return;` 这类短路。
 *
 * 边界（与 utils/greeting / utils/version 的写法约定一致）：
 *  - 只有本文件碰这两个 storage key；页面不写 key 字面量（缓存键是第二份真源的风险点）；
 *  - 任何 storage 异常（未登录 / 基础库差异 / 脏值）一律按「空集合」处理，**绝不外抛**
 *    —— 一个显示态的问题不该让收藏动作失败；
 *  - 归一化口径与后端去重口径对齐（`glossary.service.ts` 的 `hashOf`）：
 *    `trim → toLowerCase → 压缩连续空白`。不一致会导致「缓存说收藏过、服务端说没收藏过」。
 */

/** 收藏对象维度：句子 / 单词（与 `tag='nce' | 'word'` 一一对应，各自一个 storage key） */
export type CollectKind = 'word' | 'line';

/**
 * 缓存键（本文件是唯一引用处；页面/组件不得写字面量）。
 * 按维度分两个 key 而不是一个大对象：句子很长、单词很短，分开存便于各自截断，
 * 也避免「句子条目把单词条目挤出去」。
 */
export const COLLECT_CACHE_KEYS: Record<CollectKind, string> = {
  word: 'dachengzi_collected_words',
  line: 'dachengzi_collected_lines',
};

/**
 * 每个维度最多保留多少条（LRU 近似：超出丢最老的）。
 * 300 条 × 平均 60 字符 ≈ 20KB 级，远低于 storage 单 key 1MB 上限；
 * 上限的意义是「别让一个只增不减的集合无限长下去」。
 */
const MAX_ENTRIES = 300;

/** 与后端 `hashOf` 同口径的归一化：trim → 小写 → 连续空白压成一个空格 */
export function normalizeCollectKey(text: string): string {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 读缓存集合（永远返回数组，脏值一律当空）。
 * 单独 export 出来是为了让测试能直接对「脏 storage」下断言，
 * 而不是只能通过 isCollectedCached 间接看结果。
 */
export function readCollectedKeys(kind: CollectKind): string[] {
  const key = COLLECT_CACHE_KEYS[kind];
  if (!key) return [];
  try {
    // 单测 / 极端环境下 wx 可能不存在：不 try 就直接抛，会污染收藏主链路
    if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return [];
    const raw = wx.getStorageSync(key);
    if (!Array.isArray(raw)) return [];        // 老版本 / 手改 storage / '' 都走这里
    const out: string[] = [];
    for (const v of raw) {
      const s = typeof v === 'string' ? v.trim() : '';
      // 空串与重复项一律剔除：它们只会让按钮显示「已收藏」而实际对不上任何条目
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

/** 该句 / 该词在本地缓存里是否被标记为「已收藏」 */
export function isCollectedCached(kind: CollectKind, text: string): boolean {
  const k = normalizeCollectKey(text);
  if (!k) return false;
  return readCollectedKeys(kind).indexOf(k) >= 0;
}

/**
 * 收藏**成功后**写入缓存（唯一写入口）。
 * 调用时机：`collectGlossary` resolve 且 `ok=true` —— 新建与「已存在」都算已收藏，
 * 两种都要写：`existed=true` 恰恰说明它现在仍在收藏里（这正是缓存纠偏的时刻）。
 */
export function rememberCollected(kind: CollectKind, text: string): void {
  const k = normalizeCollectKey(text);
  const key = COLLECT_CACHE_KEYS[kind];
  if (!k || !key) return;
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
    const cur = readCollectedKeys(kind);
    if (cur.indexOf(k) >= 0) return;           // 已存在：不重复写，省一次 setStorage
    cur.push(k);
    // 超出上限丢最老的（数组按写入顺序，越靠后越新）
    const next = cur.length > MAX_ENTRIES ? cur.slice(cur.length - MAX_ENTRIES) : cur;
    wx.setStorageSync(key, next);
  } catch {
    // 写缓存失败不影响收藏本身（已落库），下次收藏会再补一次
  }
}

/**
 * 从缓存里移除一条（**目前无调用点，故意保留**）。
 *
 * 为什么不删：缓存失效的唯一已知场景（用户在收藏页删除）本文件**感知不到**，
 * 目前靠「点一下就走真实写请求」把状态纠正回来（见文件头）。若将来做静默回查，
 * 回查结果 `exists=false` 的正确处理就应该是调它 —— 留一个成对的出口，
 * 免得将来有人为了「删一条」去直接 `wx.setStorageSync(key, 全部重写)` 造出第二份真源。
 */
export function forgetCollected(kind: CollectKind, text: string): void {
  const k = normalizeCollectKey(text);
  const key = COLLECT_CACHE_KEYS[kind];
  if (!k || !key) return;
  try {
    if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return;
    const cur = readCollectedKeys(kind);
    const next = cur.filter((v) => v !== k);
    if (next.length === cur.length) return;
    wx.setStorageSync(key, next);
  } catch {
    // 同 rememberCollected：缓存写失败不是错误路径
  }
}
