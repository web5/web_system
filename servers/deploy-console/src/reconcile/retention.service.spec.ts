import { RetentionService, retentionCutoff, DEFAULT_KEEP_DAYS } from './retention.service';

/**
 * 数据保留（诊断 #18）。
 *
 * 删数据不可逆，所以这里锁的全是**安全边界**，不是「能不能删」：
 * ① 默认只观测 ② keepDays 非法即拒绝 ③ 指针指向的版本永不清 ④ 只删终态任务。
 * 任何一条被改坏，都可能在某天早上把还能用的回滚入口或审计线索清掉。
 */
describe('RetentionService（诊断 #18 数据保留）', () => {
  const DAY = 24 * 60 * 60 * 1000;
  let query: jest.Mock;
  let svc: RetentionService;

  const makeSvc = (map: Record<string, string | undefined>) =>
    new RetentionService({ get: (k: string) => map[k] } as never, { query } as never);

  beforeEach(() => {
    query = jest.fn(async () => [{ c: 0 }]);
  });

  describe('retentionCutoff（纯函数）', () => {
    it('保留 N 天 → 截止点 = now - N 天', () => {
      expect(retentionCutoff(1_000_000_000, 90)).toBe(1_000_000_000 - 90 * DAY);
    });

    /** 这条是防止误配把表清空 */
    it('keepDays < 1 → 返回 null（调用方据此拒绝执行）', () => {
      expect(retentionCutoff(Date.now(), 0)).toBeNull();
      expect(retentionCutoff(Date.now(), -1)).toBeNull();
      expect(retentionCutoff(Date.now(), Number.NaN)).toBeNull();
    });
  });

  describe('默认只观测（不可逆操作的安全默认）', () => {
    it('RETENTION_ENABLED 未设 → 只统计不删除', async () => {
      svc = makeSvc({});
      query.mockImplementation(async (sql: string) =>
        sql.startsWith('SELECT COUNT') ? [{ c: 42 }] : [],
      );
      const r = await svc.run(1_000_000_000);
      expect(r.enabled).toBe(false);
      expect(r.status).toBe('dry-run');
      expect(r.tables.every((t) => t.deleted === 0)).toBe(true);
      expect(r.tables.some((t) => t.candidates === 42)).toBe(true);
      // 关键：一条 DELETE 都不能发
      expect(query.mock.calls.filter((c) => String(c[0]).startsWith('DELETE'))).toHaveLength(0);
    });

    it('KEEP_DAYS 非法 → skipped 且不删', async () => {
      svc = makeSvc({ RETENTION_ENABLED: 'true', RETENTION_KEEP_DAYS: '0' });
      const r = await svc.run(1_000_000_000);
      expect(r.status).toBe('skipped');
      expect(r.reason).toContain('≥1');
    });
  });

  describe('保护名单（指针指向的版本不能删）', () => {
    it('deploy_versions 排除 current/previous 指向的版本', async () => {
      svc = makeSvc({ RETENTION_ENABLED: 'true' });
      // 指针表两行：env-dir 新表 + legacy 表
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM deploy_app_env_versions'))
          return [{ env_id: 'prod', app_key: 'portal', current_version: 'v2', previous_version: 'v1' }];
        if (sql.includes('FROM deploy_deployments'))
          return [{ env_id: 'dev', module_key: 'auth-service', current_version: 'a9' }];
        if (sql.startsWith('SELECT COUNT')) return [{ c: 3 }];
        return { affectedRows: 0 };
      });

      await svc.run(1_000_000_000);
      const del = query.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.startsWith('DELETE FROM `deploy_versions`'));
      expect(del.length).toBeGreaterThan(0);
      // 三个受保护键（portal v2/v1 + auth-service a9）都要出现在 NOT (...) 里
      expect(del[0]).toContain('NOT (');
      expect(del[0].match(/\(env = \? AND component = \? AND version_tag = \?\)/g)?.length).toBe(3);
    });

    it('只删终态任务：running/pending 必须留在原表', async () => {
      svc = makeSvc({ RETENTION_ENABLED: 'true' });
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM deploy_app_env_versions')) return [];
        if (sql.includes('FROM deploy_deployments')) return [];
        if (sql.startsWith('SELECT COUNT')) return [{ c: 5 }];
        return { affectedRows: 0 };
      });
      await svc.run(1_000_000_000);
      const del = query.mock.calls
        .map((c) => String(c[0]))
        .find((s) => s.startsWith('DELETE FROM `deploy_tasks`'));
      expect(del).toContain("status IN ('success','failed','cancelled')");
    });
  });

  describe('配置读取', () => {
    it('KEEP_DAYS 缺省 90', () => {
      expect(makeSvc({}).keepDays).toBe(DEFAULT_KEEP_DAYS);
    });

    it('RETENTION_ENABLED 大小写与空格容错', () => {
      expect(makeSvc({ RETENTION_ENABLED: ' TRUE ' }).enabled).toBe(true);
      expect(makeSvc({ RETENTION_ENABLED: 'true' }).enabled).toBe(true);
      expect(makeSvc({ RETENTION_ENABLED: '1' }).enabled).toBe(false);
    });
  });
});
