/**
 * 数据库连接目标守卫 —— 纯函数单测 + 双服务接入静态断言。
 *
 * 最后一组断言是**变异验证**用的：若有人把任一服务 app.module.ts 的
 * `database` / `synchronize` 改回「各看各的环境变量」老写法，这组断言必须红，
 * 否则纯函数单测会因「守卫写对了但服务没接上」而假绿。
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  DatabaseTargetError,
  DB_TARGET_ALLOWLIST_ENV,
  DEFAULT_DB_TARGET,
  FORBIDDEN_DB_TARGETS,
  resolveDbTarget,
} from './database-target';

describe('resolveDbTarget（误连库防建表，共享实现）', () => {
  it('默认主库 + development：保持原有 synchronize 行为', () => {
    const r = resolveDbTarget({ database: DEFAULT_DB_TARGET, nodeEnv: 'development' });
    expect(r).toMatchObject({ database: 'web_system', synchronize: true, allowlisted: true });
    expect(r.reasons.join()).toContain('白名单主库');
  });

  it('未设 DB_DATABASE 时回落主库；未设 NODE_ENV 视为非 production（与原判据一致）', () => {
    expect(resolveDbTarget({}).database).toBe('web_system');
    expect(resolveDbTarget({}).synchronize).toBe(true);
    expect(resolveDbTarget({ database: '   ' }).database).toBe('web_system');
  });

  it('production 恒关闭 synchronize（即使库名在白名单内）', () => {
    const r = resolveDbTarget({ database: DEFAULT_DB_TARGET, nodeEnv: 'production' });
    expect(r.synchronize).toBe(false);
    expect(r.reasons.join()).toContain('production');
  });

  it.each(FORBIDDEN_DB_TARGETS)('黑名单库 %s 在 development 下拒绝启动', (db) => {
    expect(() => resolveDbTarget({ database: db, nodeEnv: 'development' })).toThrow(DatabaseTargetError);
  });

  it.each(FORBIDDEN_DB_TARGETS)('黑名单库 %s 在 production 下同样拒绝启动', (db) => {
    expect(() => resolveDbTarget({ database: db, nodeEnv: 'production' })).toThrow(DatabaseTargetError);
  });

  it('非白名单别名库 + development（会 synchronize）→ 拒绝，错误信息给出可操作指引', () => {
    expect(() => resolveDbTarget({ database: 'web_system_test', nodeEnv: 'development' })).toThrow(
      new RegExp(`${DB_TARGET_ALLOWLIST_ENV}=web_system_test`),
    );
  });

  it('非白名单别名库 + 显式 allowlist → 放行并允许 synchronize', () => {
    const r = resolveDbTarget({
      database: 'web_system_test',
      nodeEnv: 'development',
      allowlist: 'web_system_test',
    });
    expect(r).toMatchObject({ database: 'web_system_test', synchronize: true, allowlisted: true });
  });

  it('aliases 首尾空格 / 重复项 / 默认主库重复声明都归一化', () => {
    const r = resolveDbTarget({
      database: 'web_system_test',
      nodeEnv: 'development',
      allowlist: ' web_system_test , , web_system_test , web_system ',
    });
    expect(r.reasons).toContain('allowlist=[web_system,web_system_test]');
  });

  it('非白名单别名库 + production → 可启动兼容，但绝不 synchronize', () => {
    const r = resolveDbTarget({ database: 'web_system_prod_alias', nodeEnv: 'production' });
    expect(r.database).toBe('web_system_prod_alias');
    expect(r.synchronize).toBe(false);
    expect(r.allowlisted).toBe(false);
    expect(r.reasons.join()).toContain('allowlisted=false');
  });

  it('黑名单库即使被写进 allowlist 也不放行（黑名单优先级更高）', () => {
    expect(() =>
      resolveDbTarget({
        database: 'web_system_deploy',
        nodeEnv: 'development',
        allowlist: 'web_system_deploy',
      }),
    ).toThrow(DatabaseTargetError);
  });
});

describe('双服务接入共享守卫（防「函数写了但没接上」）', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const modules: ReadonlyArray<readonly [string, string]> = [
    ['content-hub', 'servers/content-hub/src/app.module.ts'],
    ['mcp-gateway', 'servers/mcp-gateway/src/app.module.ts'],
  ];

  const read = (rel: string): string => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it.each(modules)('%s 从 @web-system/shared 引入守卫并计算 dbTarget', (_name, rel) => {
    const source = read(rel);
    expect(source).toContain("from '@web-system/shared'");
    expect(source).toContain('resolveDbTarget(');
    expect(source).toContain('DB_TARGET_ALLOWLIST_ENV');
    expect(source).not.toContain("from './common/database-target'");
  });

  it.each(modules)('%s 的 mysql/postgres 两分支都取自 dbTarget', (_name, rel) => {
    const source = read(rel);
    const dbUses = source.split('database: dbTarget.database').length - 1;
    const syncUses = source.split('synchronize: dbTarget.synchronize').length - 1;
    expect(dbUses).toBe(2);
    expect(syncUses).toBe(2);
    expect(source).not.toContain(
      "synchronize: configService.get('NODE_ENV') !== 'production'",
    );
    expect(source).not.toContain("database: configService.get<string>('DB_DATABASE', 'web_system')");
  });
});
