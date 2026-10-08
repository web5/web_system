import { EnvSplitWriterService } from './env-split-writer.service';
import { CloudDbService } from './cloud-db.service';

/** 造一个 CloudDbService 桩：可控 enabled / strict / query 行为 */
function makeCloud(opts: { enabled?: boolean; strict?: boolean } = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  let queryImpl: (sql: string, params: unknown[]) => Promise<unknown> = async () => [];
  const cloud = {
    get enabled() {
      return opts.enabled ?? true;
    },
    get strict() {
      return opts.strict ?? true;
    },
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return queryImpl(sql, params);
    }),
  };
  return {
    cloud: cloud as unknown as CloudDbService,
    calls,
    setQuery: (fn: (sql: string, params: unknown[]) => Promise<unknown>) => {
      queryImpl = fn;
    },
  };
}

describe('EnvSplitWriterService（按环境分流 → 云数据库镜像写）', () => {
  describe('mirrorPointer（版本指针）', () => {
    it('未启用 → skipped（行为等同人工同步现状）', async () => {
      const { cloud } = makeCloud({ enabled: false });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v1' });
      expect(r.outcome).toBe('skipped');
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('非 prod 环境 → skipped（dev/local 数据留本地库）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorPointer({ env: 'dev', moduleKey: 'portal', currentVersion: 'v1' });
      expect(r.outcome).toBe('skipped');
      expect(r.reason).toContain('dev');
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('prod：先读旧版本作 previous_version，再 upsert（与本地语义一致）', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      // 第一次查询返回云库现有版本（旧值）
      let n = 0;
      (cloud.query as jest.Mock).mockImplementation(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        n += 1;
        return n === 1 ? [{ current_version: 'v-old' }] : [];
      });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorPointer({
        env: 'prod',
        moduleKey: 'shell',
        currentVersion: 'v-new',
        deployedBy: 'op',
        taskId: 't-1',
      });
      expect(r.outcome).toBe('ok');
      // 1) 读旧值 2) upsert
      expect(calls).toHaveLength(2);
      expect(calls[0].sql).toContain('SELECT current_version FROM deploy_app_env_versions');
      expect(calls[1].sql).toContain('INSERT INTO deploy_app_env_versions');
      expect(calls[1].sql).toContain('ON DUPLICATE KEY UPDATE');
      // 列顺序：app_key, env_id, current_version, previous_version, deployed_at, deployed_by, task_id
      expect(calls[1].params.slice(0, 4)).toEqual(['shell', 'prod', 'v-new', 'v-old']);
    });

    it('prod 且云库无历史行 → previous_version 为 null', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      await svc.mirrorPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v1' });
      expect(calls[1].params[3]).toBeNull();
    });

    it('严格模式：prod 写云库失败 → 抛出（任务必须红掉，不能静默不一致）', async () => {
      const { cloud } = makeCloud({ enabled: true, strict: true });
      (cloud.query as jest.Mock).mockRejectedValue(new Error('ETIMEDOUT'));
      const svc = new EnvSplitWriterService(cloud);
      await expect(
        svc.mirrorPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v1' }),
      ).rejects.toThrow(/prod 指针未生效/);
    });

    it('非严格模式（应急）：失败只返回 failed，不抛出', async () => {
      const { cloud } = makeCloud({ enabled: true, strict: false });
      (cloud.query as jest.Mock).mockRejectedValue(new Error('ETIMEDOUT'));
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorPointer({ env: 'prod', moduleKey: 'shell', currentVersion: 'v1' });
      expect(r.outcome).toBe('failed');
      expect(r.error).toContain('ETIMEDOUT');
    });
  });

  describe('mirrorLegacyPointer（legacy 应急读取源）', () => {
    it('prod：upsert deploy_deployments', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorLegacyPointer({
        env: 'prod',
        moduleKey: 'auth-service',
        currentVersion: 'v1',
      });
      expect(r.outcome).toBe('ok');
      expect(calls[0].sql).toContain('INSERT INTO deploy_deployments');
    });

    it('失败不阻断（legacy 不是 gateway 默认读取源）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      (cloud.query as jest.Mock).mockRejectedValue(new Error('conn lost'));
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorLegacyPointer({ env: 'prod', moduleKey: 'x', currentVersion: 'v1' });
      expect(r.outcome).toBe('failed');
    });

    it('dev 环境不镜像', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorLegacyPointer({ env: 'dev', moduleKey: 'x', currentVersion: 'v1' });
      expect(r.outcome).toBe('skipped');
      expect(cloud.query).not.toHaveBeenCalled();
    });
  });

  describe('mirrorRows（配置表镜像，M4 用）', () => {
    it('白名单外的表直接跳过（防止误写平台内部表）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorRows('deploy_pipeline_vars', [{ id: '1' }]);
      expect(r.outcome).toBe('skipped');
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('白名单内的表按唯一键 upsert', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      const r = await svc.mirrorRows('deploy_modules', [{ key: 'shell', name: '基座' }], ['key']);
      expect(r.outcome).toBe('ok');
      expect(calls[0].sql).toContain('INSERT INTO deploy_modules');
      expect(calls[0].sql).toContain('ON DUPLICATE KEY UPDATE');
      // 唯一键 key 不进 UPDATE 列表
      expect(calls[0].sql).not.toMatch(/ON DUPLICATE KEY UPDATE.*`key` = VALUES/s);
    });
  });

  describe('M4 配置镜像：mirrorRow / deleteMirror / 异步队列', () => {
    it('实体 camelCase 自动转 snake_case，json 列序列化成字符串', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.mirrorRow('deploy_services', {
        key: 'auth-service',
        defaultPort: 3001,
        builtin: true,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      await svc.flush();
      const call = calls.find((c) => c.sql.includes('INSERT INTO deploy_services'));
      expect(call).toBeDefined();
      expect(call!.sql).toContain('`default_port`');
      expect(call!.sql).toContain('`key`');
      // uniqueKeys = ['key'] → key 出现在 INSERT 列里但不出现在 UPDATE 列表
      expect(call!.sql).toContain('ON DUPLICATE KEY UPDATE');
      expect(call!.sql).not.toMatch(/ON DUPLICATE KEY UPDATE[^;]*`key` = VALUES/s);
    });

    it('json 列（对象）必须变成字符串，否则 mysql2 会报错', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.mirrorRow('deploy_canary_rules', { id: 'r1', matchRule: { type: 'percent', value: 20 } });
      await svc.flush();
      const call = calls.find((c) => c.sql.includes('INSERT INTO deploy_canary_rules'));
      expect(call).toBeDefined();
      const mrIdx = call!.sql.indexOf('match_rule');
      expect(mrIdx).toBeGreaterThan(-1);
      const mrValue = (call!.params as unknown[]).find((v) => typeof v === 'string' && v.includes('percent'));
      expect(mrValue).toBe(JSON.stringify({ type: 'percent', value: 20 }));
    });

    it('缺少唯一键的行跳过并记录告警（无法 upsert）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      // deploy_endpoints 的唯一键是 service_key + method + path_pattern
      svc.mirrorRow('deploy_endpoints', { id: 'e1', serviceKey: 'auth-service' });
      await svc.flush();
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('同一「表 + 唯一键」多次写只保留最后一次（去重，避免公网写放大）', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.mirrorRow('deploy_services', { key: 'svc-a', name: 'v1' });
      svc.mirrorRow('deploy_services', { key: 'svc-a', name: 'v2' });
      svc.mirrorRow('deploy_services', { key: 'svc-a', name: 'v3' });
      await svc.flush();
      const upserts = calls.filter((c) => c.sql.includes('INSERT INTO deploy_services'));
      expect(upserts).toHaveLength(1);
      expect(upserts[0].params).toContain('v3');
    });

    it('未启用 → 完全不入队（零开销）', async () => {
      const { cloud } = makeCloud({ enabled: false });
      const svc = new EnvSplitWriterService(cloud);
      svc.mirrorRow('deploy_services', { key: 'svc-a' });
      await svc.flush();
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('云库写失败**不抛出**（配置漂移不阻断业务写，design §6）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      (cloud.query as jest.Mock).mockRejectedValue(new Error('ETIMEDOUT'));
      expect(() => svc.mirrorRow('deploy_services', { key: 'svc-a' })).not.toThrow();
      await expect(svc.flush()).resolves.toBeUndefined();
    });

    it('deleteMirror：本地物理删除必须同步到云库', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.deleteMirror('deploy_canary_rules', { id: 'r1' });
      await svc.flush();
      const call = calls.find((c) => c.sql.includes('DELETE FROM deploy_canary_rules'));
      expect(call).toBeDefined();
      expect(call!.params).toEqual(['r1']);
    });

    it('deleteMirror：条件为空时拒绝执行（防误删整表）', async () => {
      const { cloud } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.deleteMirror('deploy_endpoints', {});
      await svc.flush();
      expect(cloud.query).not.toHaveBeenCalled();
    });

    it('deleteMirror：camelCase 条件同样转 snake_case', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.deleteMirror('deploy_service_envs', { envId: 'dev' });
      await svc.flush();
      const call = calls.find((c) => c.sql.includes('DELETE FROM deploy_service_envs'));
      expect(call!.sql).toContain('`env_id` = ?');
    });

    it('batch：mirrorEntities 过滤掉 null/undefined', async () => {
      const { cloud, calls } = makeCloud({ enabled: true });
      const svc = new EnvSplitWriterService(cloud);
      svc.mirrorEntities('deploy_endpoints', [
        { id: 'e1', serviceKey: 'auth', method: 'GET', pathPattern: '/api/a' },
        null,
        undefined,
      ]);
      await svc.flush();
      const upserts = calls.filter((c) => c.sql.includes('INSERT INTO deploy_endpoints'));
      expect(upserts).toHaveLength(1);
    });
  });
});
