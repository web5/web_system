/**
 * 阶段③ S4 · 服务端只读「今日一句」资产与 GET 接口验收。
 *
 * 该接口是冻结内容资产：controller 只读 JSON、无任何生成逻辑、不调 LLM。
 * 这里用直接调用 controller 方法的方式（不依赖数据库 / Nest DI），
 * 断言信封 {code:0,data,message:'ok'} + 资产零编造 + 只读 + 可选 version 非法忽略。
 */
import { readFileSync, statSync } from 'node:fs';
import { NceController } from './nce.controller';
import { loadDailyQuotesPool, DAILY_QUOTES_ASSET_PATH } from './daily-quotes.data';

// 2026-11-25：移除硬编码的本机绝对路径 LESSONS（指向开发者本机 lessons.json）。
// CI runner 无该文件 → V2 溯源必 ENOENT（144 §四一手日志 :49）。改为资产内嵌 source 自洽校验。

describe('loadDailyQuotesPool（服务端冻结资产只读加载）', () => {
  it('返回 {version,count,items}，count 与 items.length 自洽 = 136', () => {
    const pool = loadDailyQuotesPool();
    expect(typeof pool.version).toBe('number');
    expect(pool.version).toBe(1);
    expect(pool.count).toBe(136);
    expect(Array.isArray(pool.items)).toBe(true);
    expect(pool.items.length).toBe(pool.count);
  });

  it('每条结构中性：items[] 元素含 {cn,en,source}，cn/en 非空，source 锚点合法且身份键唯一', () => {
    const pool = loadDailyQuotesPool();
    const keys = new Set<string>();
    for (const q of pool.items) {
      expect(Object.keys(q).sort()).toEqual(['cn', 'en', 'source']);
      expect(typeof q.cn).toBe('string');
      expect(q.cn.length).toBeGreaterThan(0);
      expect(typeof q.en).toBe('string');
      expect(q.en.length).toBeGreaterThan(0);
      expect(q.source.book).toBe('NCE2');
      expect(Number.isInteger(q.source.lessonId)).toBe(true);
      expect(q.source.lessonId).toBeGreaterThanOrEqual(1);
      expect(q.source.lessonId).toBeLessThanOrEqual(96);
      expect(typeof q.source.title).toBe('string');
      expect(q.source.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(q.source.lineIndex)).toBe(true);
      expect(q.source.lineIndex).toBeGreaterThanOrEqual(0);
      const key = `${q.source.lessonId}:${q.source.lineIndex}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBe(136);
  });

  /**
   * V2 零编造 · 资产内嵌 source 自洽校验（2026-11-25 口径降级，如实标注）。
   *
   * 🔴 校验口径变化：原用例反查本机原文 lessons.json（硬编码本机绝对路径），逐字比对
   *    cn/en/title/book；CI runner 无该文件 → ENOENT 必红（144 §四一手日志 :49）。
   *    现降级为「资产内自洽」：以仓库内 daily-quotes.json 的 items[].source 为唯一依据，
   *    校验 source 四字段齐全合法、cn/en 非空配对、book 恒 NCE2、lessonId 合理范围、
   *    lineIndex 非负、身份键 lessonId:lineIndex 唯一、version/count/items.length 三者一致。
   *    失去的是「逐字反查原文」这一层最强保证；原文 sha16 40339154ec0a54ad 仍由资产头注留痕。
   *    未编造 lessons.json 入仓冒充原文。
   * 🔴 断言强度不放宽：原 1 条 mismatches=0（4 字段逐字）→ 现 1 条 mismatches=0
   *    （多字段齐全性 + 配对 + 范围 + 唯一性逐条累加），另保留 keys.size=136 与版本数量自洽断言。
   */
  it('V2 零编造·资产内自洽：source 字段齐全 + cn/en 配对非空 + lessonId/lineIndex 合法 + 身份键唯一 + version/count 一致（mismatches=0）', () => {
    const pool = loadDailyQuotesPool();
    const raw = JSON.parse(readFileSync(DAILY_QUOTES_ASSET_PATH, 'utf-8'));
    expect(raw.version).toBe(pool.version);
    expect(raw.count).toBe(pool.count);
    expect(raw.items.length).toBe(pool.count);
    expect(pool.items.length).toBe(pool.count);

    const keys = new Set<string>();
    let mismatches = 0;
    for (const q of pool.items) {
      const s = q.source;
      const anchorOK = s.book === 'NCE2'
        && Number.isInteger(s.lessonId) && s.lessonId >= 1 && s.lessonId <= 96
        && typeof s.title === 'string' && s.title.length > 0
        && Number.isInteger(s.lineIndex) && s.lineIndex >= 0;
      const pairOK = typeof q.cn === 'string' && q.cn.length > 0
        && typeof q.en === 'string' && q.en.length > 0;
      if (!anchorOK || !pairOK) { mismatches += 1; continue; }
      const key = `${s.lessonId}:${s.lineIndex}`;
      if (keys.has(key)) { mismatches += 1; continue; }
      keys.add(key);
    }
    expect(keys.size).toBe(136);
    expect(mismatches).toBe(0);
  });

  it('资产头注含版权与来源 sha16（不调外部 LLM、原文不出本机）', () => {
    const raw = JSON.parse(readFileSync(DAILY_QUOTES_ASSET_PATH, 'utf-8'));
    expect(raw._notice).toContain('仅供个人学习，不对外分发');
    expect(raw._notice).toContain('40339154ec0a54ad');
    expect(raw._notice).toContain('NCE 原文筛选');
  });
});

describe('NceController.dailyQuotes（服务端只读 GET）', () => {
  const controller = new NceController({} as any);

  it('返回 ok 信封 {code:0,data,message:ok}，data 为冻结池', () => {
    const res = controller.dailyQuotes();
    expect(res.code).toBe(0);
    expect(res.message).toBe('ok');
    expect(res.data.count).toBe(136);
    expect(res.data.items.length).toBe(136);
    expect(res.data.version).toBe(1);
  });

  it('只读：连续两次返回深相等，且不改动磁盘资产（mtime/字节不变）', () => {
    const before = statSync(DAILY_QUOTES_ASSET_PATH);
    const a = controller.dailyQuotes();
    const b = controller.dailyQuotes();
    expect(a).toEqual(b);
    const after = statSync(DAILY_QUOTES_ASSET_PATH);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it('可选 ?version：合法整数与非法串都忽略、不 500，恒返回同池', () => {
    const valid = controller.dailyQuotes('1');
    const garbage = controller.dailyQuotes('not-an-int');
    const negative = controller.dailyQuotes('-3');
    expect(garbage.code).toBe(0);
    expect(negative.code).toBe(0);
    expect(garbage.data.count).toBe(136);
    expect(garbage.data).toEqual(valid.data);
  });
});
