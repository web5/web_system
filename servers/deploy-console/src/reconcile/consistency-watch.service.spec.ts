import { ConsistencyWatchService, sameValue } from './consistency-watch.service';

describe('sameValue（两库值比较）', () => {
  it('数字与字符串互通（驱动返回类型可能不同）', () => {
    expect(sameValue(1, '1')).toBe(true);
    expect(sameValue('prod', 'prod')).toBe(true);
  });

  it('null / undefined 视为相等', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(null, '')).toBe(false);
  });

  it('值不同 → false', () => {
    expect(sameValue('v1', 'v2')).toBe(false);
  });
});

describe('ConsistencyWatchService（诊断 #13：两库一致性巡检）', () => {
  let cfg: { get: jest.Mock };
  let cloud: { enabled: boolean; query: jest.Mock };
  let local: { query: jest.Mock };
  let svc: ConsistencyWatchService;

  /** information_schema 返回的列；两表各回一次 */
  const columnsOf = (table: string) =>
    table === 'deploy_app_env_versions'
      ? [{ name: 'app_key' }, { name: 'env_id' }, { name: 'current_version' }, { name: 'previous_version' }, { name: 'id' }, { name: 'deployed_at' }]
      : [{ name: 'module_key' }, { name: 'env_id' }, { name: 'current_version' }, { name: 'id' }];

  beforeEach(() => {
    cfg = { get: jest.fn(() => undefined) };
    cloud = { enabled: true, query: jest.fn(async () => []) };
    local = {
      query: jest.fn(async (sql: string) =>
        String(sql).includes('information_schema')
          ? columnsOf(/deploy_app_env_versions/.test(sql) ? 'deploy_app_env_versions' : 'deploy_deployments')
          : [],
      ),
    };
    svc = new ConsistencyWatchService(cfg as never, cloud as never, local as never);
  });

  it('云库未启用 → skipped（不算通过也不算失败）', async () => {
    cloud.enabled = false;
    const r = await svc.check();
    expect(r.status).toBe('skipped');
    expect(r.diffs).toEqual([]);
    expect(cloud.query).not.toHaveBeenCalled();
  });

  it('两库一致 → ok，并回报检查行数', async () => {
    // 只在 deploy_app_env_versions 上放一行（另一张表空），避免跨表重复计数
    local.query = jest.fn(async (sql: string) => {
      const s = String(sql);
      if (s.includes('information_schema')) {
        return columnsOf(s.includes('deploy_app_env_versions') ? 'deploy_app_env_versions' : 'deploy_deployments');
      }
      if (!s.includes('deploy_app_env_versions')) return [];
      return [{ app_key: 'portal', env_id: 'prod', current_version: 'v1', previous_version: 'v0' }];
    });
    cloud.query = jest.fn(async (sql: string) => {
      if (!String(sql).includes('deploy_app_env_versions')) return [];
      return [{ app_key: 'portal', env_id: 'prod', current_version: 'v1', previous_version: 'v0' }];
    });
    const r = await svc.check();
    expect(r.status).toBe('ok');
    expect(r.checkedRows).toBe(1);
    expect(r.diffs).toEqual([]);
  });

  it('指针漂移 → drift，逐字段列出本地/云库值', async () => {
    local.query = jest.fn(async (sql: string) => {
      if (String(sql).includes('information_schema')) return columnsOf('deploy_app_env_versions');
      return [{ app_key: 'portal', env_id: 'prod', current_version: 'v2', previous_version: 'v1' }];
    });
    cloud.query = jest.fn(async () => [
      { app_key: 'portal', env_id: 'prod', current_version: 'v1', previous_version: 'v0' },
    ]);
    const r = await svc.check();
    expect(r.status).toBe('drift');
    expect(r.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'deploy_app_env_versions', key: 'portal@prod', field: 'current_version', local: 'v2', cloud: 'v1' }),
      ]),
    );
  });

  it('行只存在于云库 → 记为漂移（本地缺失）', async () => {
    local.query = jest.fn(async (sql: string) =>
      String(sql).includes('information_schema') ? columnsOf('deploy_app_env_versions') : [],
    );
    cloud.query = jest.fn(async () => [
      { app_key: 'portal', env_id: 'prod', current_version: 'v1' },
    ]);
    const r = await svc.check();
    expect(r.status).toBe('drift');
    expect(r.diffs[0]).toMatchObject({ local: '缺失', cloud: '存在' });
  });

  it('忽略 id/deployed_by/deployed_at 等允许不同的字段', async () => {
    local.query = jest.fn(async (sql: string) =>
      String(sql).includes('information_schema')
        ? columnsOf('deploy_app_env_versions')
        : [{ app_key: 'portal', env_id: 'prod', current_version: 'v1', id: 'local-uuid', deployed_at: 1 }],
    );
    cloud.query = jest.fn(async () => [
      { app_key: 'portal', env_id: 'prod', current_version: 'v1', id: 'cloud-uuid', deployed_at: 2 },
    ]);
    const r = await svc.check();
    expect(r.status).toBe('ok');
    expect(r.diffs).toEqual([]);
  });

  it('只比对 prod 行（dev 按设计不镜像，不能算漂移）', async () => {
    local.query = jest.fn(async (sql: string) =>
      String(sql).includes('information_schema') ? columnsOf('deploy_app_env_versions') : [],
    );
    await svc.check();
    const sqls = (local.query as jest.Mock).mock.calls.map((c) => String(c[0]));
    const dataSqls = sqls.filter((s) => !s.includes('information_schema'));
    expect(dataSqls.length).toBeGreaterThan(0);
    for (const s of dataSqls) expect(s).toContain('env_id = ?');
    for (const p of (local.query as jest.Mock).mock.calls) {
      if (!String(p[0]).includes('information_schema')) expect(p[1]).toEqual(['prod']);
    }
  });

  it('云库异常 → error 且回报原因（不让巡检自己崩掉）', async () => {
    cloud.query = jest.fn(async () => {
      throw new Error('云数据库查询超时');
    });
    const r = await svc.check();
    expect(r.status).toBe('error');
    expect(r.reason).toContain('超时');
  });

  it('结果可被 lastReport 取回（供诊断接口展示）', async () => {
    expect(svc.lastReport()).toBeUndefined();
    cloud.enabled = false;
    const r = await svc.check();
    expect(svc.lastReport()).toEqual(r);
  });

  it('CONSISTENCY_CHECK_INTERVAL_MS=0 → 不启动定时', () => {
    cfg.get.mockImplementation((k: string) => (k === 'CONSISTENCY_CHECK_INTERVAL_MS' ? '0' : undefined));
    const s = new ConsistencyWatchService(cfg as never, cloud as never, local as never);
    expect(() => s.onModuleInit()).not.toThrow();
    expect(() => s.onModuleDestroy()).not.toThrow();
  });

  it('默认启用定时并可安全销毁', () => {
    const s = new ConsistencyWatchService(cfg as never, cloud as never, local as never);
    expect(() => s.onModuleInit()).not.toThrow();
    expect(() => s.onModuleDestroy()).not.toThrow();
  });
});
