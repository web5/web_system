/**
 * s33 · seed-daily-quotes.mjs 静态契约验收（V4/V5/V6 的脚本侧锁定）。
 *
 * seed 是 .mjs 运维脚本（无导出，需连库才 INSERT），本 spec 在**源码层**锁定其关键不变量：
 *  - 常量 sha/version/count 与 daily-quotes.data.ts 一致；
 *  - 身份键含 source_book（跨册同 lessonId+lineIndex 不互覆）；
 *  - book 白名单含三册、按册课号上限；
 *  - 清理规则保留 v1（回滚依赖），只清 > 本版或本版越界 ordinal；
 *  - 参数化绑定（无 SQL 字符串拼接）、无本机绝对路径硬编码。
 * 实际 dry-run 逐字校验由回执 V5/V6 命令执行；写库幂等由运维上线阶段验证（本轮不连库）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DAILY_QUOTES_ASSET_SHA256,
  DAILY_QUOTES_FROZEN_COUNT,
  DAILY_QUOTES_FROZEN_VERSION,
} from './daily-quotes.data';

const SEED_PATH = resolve(__dirname, '../../../../scripts/seed-daily-quotes.mjs');
const SEED = readFileSync(SEED_PATH, 'utf-8');

describe('seed-daily-quotes.mjs 静态契约（V4/V5/V6）', () => {
  it('常量 sha/version/count 与 service 常量一致（单一真源，防漂移）', () => {
    expect(SEED).toContain(`'${DAILY_QUOTES_ASSET_SHA256}'`);
    expect(SEED).toContain(`const FROZEN_VERSION = ${DAILY_QUOTES_FROZEN_VERSION};`);
    expect(SEED).toContain(`const FROZEN_COUNT = ${DAILY_QUOTES_FROZEN_COUNT};`);
    expect(DAILY_QUOTES_FROZEN_VERSION).toBe(2);
    expect(DAILY_QUOTES_FROZEN_COUNT).toBe(281);
  });

  it('身份键含 source_book（跨册同号不互覆）；book 白名单三册 + 按册课号上限', () => {
    expect(SEED).toContain('`${s.book}:${s.lessonId}:${s.lineIndex}`');
    expect(SEED).toContain('NCE2: 96, NCE3: 60, NCE4: 48');
    expect(SEED).not.toContain('s.book === \'NCE2\'');
  });

  it('清理规则保留 v1（回滚依赖），只清 > 本版或本版越界 ordinal', () => {
    expect(SEED).toContain('const LEGACY_VERSION = 1;');
    expect(SEED).toMatch(/DELETE FROM daily_quotes WHERE pool_version > \? OR \(pool_version = \? AND ordinal > \?\)/);
    // 老规则「删 pool_version <> 1」不得回归
    expect(SEED).not.toContain('pool_version <> ? OR ordinal > ?');
  });

  it('参数化绑定（无 SQL 字符串拼接）、无本机绝对路径硬编码', () => {
    expect(SEED).toContain('ON DUPLICATE KEY UPDATE');
    expect(SEED).not.toMatch(/\/Users\/|\/home\/|C:\\/);
  });
});
