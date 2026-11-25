/// <reference types="node" />
/**
 * 阶段③ S4 · 服务端精选池资产入库校验（由 s16 的 utils/daily-quotes 随包测试迁用改写）。
 *
 * 断言不弱化、不删：原 S-V1 溯源反查 / source 锚点合法 / S-V2 中英成对 + 完整句 /
 * 零编造 / 池规模 / 首末锚点 / getDailyQuote 对外形状全部保留，只是校验对象从
 * 「随包常量 utils/daily-quotes.ts」改为「服务端冻结资产 servers/content-hub/data/daily-quotes.json」。
 *
 * 说明：单测不绑定工作机绝对路径除数据源外；NCE_LINES 是 NCE2 lessons.json 的逐字快照
 * （由 nce-quotes.test.ts 独立校验 1601/1601 反查）。s33 资产扩为三册（v2/281）：
 *  - NCE2 部分仍按 NCE_LINES 作「镜像真源」逐字反查（mismatches=0）；
 *  - NCE3/NCE4 部分按资产内嵌 source 四字段自洽 + 头注三册 sha16 锁定（lessons 不入仓）；
 *  - 三册全量逐字反查（mismatches=0）一手证据由离线脚本 + 回执 V2 的 python 命令给出。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NCE_LINES } from '../utils/nce-quotes';
import type { NceQuoteLine } from '../utils/nce-quotes';
import { getDailyQuote, FALLBACK_QUOTES } from '../utils/daily';
import { DAILY_QUOTES_CACHE_KEY } from '../services/daily-quotes';

const ASSET = resolve(__dirname, '../../../servers/content-hub/data/daily-quotes.json');
type AssetQuote = {
  cn: string;
  en: string;
  source: { book: string; lessonId: number; title: string; lineIndex: number };
};
const raw = JSON.parse(readFileSync(ASSET, 'utf-8'));
const DAILY_QUOTES: AssetQuote[] = raw.items;

// getDailyQuote 对外形状用例：注入资产池作本地缓存（service 拉取写盘后的等值状态）
function injectAssetCache(): void {
  (globalThis as { wx?: unknown }).wx = {
    getStorageSync: jest.fn((key: string) =>
      key === DAILY_QUOTES_CACHE_KEY
        ? { version: raw.version, items: DAILY_QUOTES.map(({ cn, en }) => ({ cn, en })), fetchedAt: Date.now() }
        : ''),
    setStorageSync: jest.fn(),
    showToast: jest.fn(),
  };
}

describe('DAILY_QUOTES 服务端冻结资产（阶段③ S4 · 仅精选池 / 离线 / 零编造）', () => {
  it('资产自洽：version=2 / count == items.length == 281 / 头注含版权与三册 sha16', () => {
    expect(Number.isInteger(raw.version)).toBe(true);
    expect(raw.version).toBe(2);
    expect(raw.count).toBe(281);
    expect(raw.items.length).toBe(raw.count);
    expect(raw._notice).toContain('仅供个人学习，不对外分发');
    expect(raw._notice).toContain('40339154ec0a54ad'); // NCE2
    expect(raw._notice).toContain('9558256c30524970'); // NCE3
    expect(raw._notice).toContain('4885c6aee9121a2f'); // NCE4
  });

  it('S-V1 溯源反查：NCE2 部分按 NCE_LINES 镜像真源逐字反查（mismatches=0）', () => {
    const bySource = new Map<string, NceQuoteLine>();
    for (const l of NCE_LINES) {
      bySource.set(`${l.source.lessonId}:${l.source.lineIndex}`, l);
    }
    let mismatches = 0;
    let nce2Count = 0;
    for (const q of DAILY_QUOTES) {
      if (q.source.book !== 'NCE2') continue;
      nce2Count += 1;
      const key = `${q.source.lessonId}:${q.source.lineIndex}`;
      const orig = bySource.get(key);
      if (!orig
        || orig.cn !== q.cn
        || orig.en !== q.en
        || orig.source.title !== q.source.title
        || orig.source.book !== q.source.book) {
        mismatches += 1;
      }
    }
    expect(nce2Count).toBe(136);
    expect(mismatches).toBe(0);
  });

  it('S-V1 三册身份键含 book 唯一；NCE3/NCE4 source 四字段自洽（逐字反查一手证据见回执 V2）', () => {
    const keys = new Set<string>();
    const dist: Record<string, number> = { NCE2: 0, NCE3: 0, NCE4: 0 };
    const maxByBook: Record<string, number> = { NCE2: 96, NCE3: 60, NCE4: 48 };
    for (const q of DAILY_QUOTES) {
      expect(maxByBook[q.source.book]).toBeGreaterThan(0); // book 白名单
      expect(Number.isInteger(q.source.lessonId)).toBe(true);
      expect(q.source.lessonId).toBeGreaterThanOrEqual(1);
      expect(q.source.lessonId).toBeLessThanOrEqual(maxByBook[q.source.book]);
      expect(typeof q.source.title).toBe('string');
      expect(q.source.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(q.source.lineIndex)).toBe(true);
      expect(q.source.lineIndex).toBeGreaterThanOrEqual(0);
      const key = `${q.source.book}:${q.source.lessonId}:${q.source.lineIndex}`;
      expect(keys.has(key)).toBe(false); // 含 book，跨册同号不碰撞
      keys.add(key);
      dist[q.source.book] += 1;
    }
    expect(keys.size).toBe(DAILY_QUOTES.length);
    expect(dist).toEqual({ NCE2: 136, NCE3: 80, NCE4: 65 });
  });

  it('S-V2 中英成对 + 结构中性：对外仅 {cn,en,source} 三字段，cn/en 均非空字符串', () => {
    for (const q of DAILY_QUOTES) {
      expect(Object.keys(q).sort()).toEqual(['cn', 'en', 'source']);
      expect(typeof q.cn).toBe('string');
      expect(q.cn.length).toBeGreaterThan(0);
      expect(typeof q.en).toBe('string');
      expect(q.en.length).toBeGreaterThan(0);
    }
  });

  it('S-V2 完整句：en 以 . ! ?（可带尾引号）结尾、cn 以 。！？（可带尾引号）结尾，非逗号/分号半句', () => {
    for (const q of DAILY_QUOTES) {
      const e = q.en.trim().replace(/[\u201C\u201D\u2018\u2019"']+$/, '');
      const c = q.cn.trim().replace(/[\u201C\u201D\u2018\u2019"']+$/, '');
      expect(e).toMatch(/[.!?]$/);
      expect(c).toMatch(/[。！？]$/);
      expect(e).not.toMatch(/[,;]$/);
      expect(c).not.toMatch(/[,，;；]$/);
    }
  });

  it('零编造（NCE2）：NCE2 部分 cn/en 逐字取自 NCE_LINES；三册全量反查见回执 V2', () => {
    const content = new Set(NCE_LINES.map((l) => `${l.cn}\u0000${l.en}`));
    let checked = 0;
    for (const q of DAILY_QUOTES) {
      if (q.source.book !== 'NCE2') continue;
      checked += 1;
      expect(content.has(`${q.cn}\u0000${q.en}`)).toBe(true);
    }
    expect(checked).toBe(136);
  });

  it('池规模合理：100 ≤ N ≤ 300，且严格大于兜底池，保证显示层来自精选池而非兜底', () => {
    expect(DAILY_QUOTES.length).toBeGreaterThanOrEqual(100);
    expect(DAILY_QUOTES.length).toBeLessThanOrEqual(300);
    expect(DAILY_QUOTES.length).toBeGreaterThan(FALLBACK_QUOTES.length);
  });

  it('选句质量为格言/完整句抽样：锚定首条与末条逐字内容（防快照漂移）', () => {
    const first = DAILY_QUOTES[0];
    const last = DAILY_QUOTES[DAILY_QUOTES.length - 1];
    expect(first).toMatchObject({
      cn: '我从不在星期天早起。', en: 'I never get up early on Sundays.',
      source: { book: 'NCE2', lessonId: 2, lineIndex: 1 },
    });
    expect(last).toMatchObject({
      cn: '整夜，人们都在跳舞唱歌。', en: 'All night long, people dance and sing.',
      source: { book: 'NCE2', lessonId: 96, lineIndex: 7 },
    });
  });

  it('对外 {cn,en} 形状：缓存命中时 getDailyQuote 返回资产池中的一条，不携带 source', () => {
    injectAssetCache();
    const q = getDailyQuote();
    expect(Object.keys(q).sort()).toEqual(['cn', 'en']);
    expect(DAILY_QUOTES.some((s: AssetQuote) => s.cn === q.cn && s.en === q.en)).toBe(true);
  });
});
