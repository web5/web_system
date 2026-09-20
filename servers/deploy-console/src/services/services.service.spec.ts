import { ConflictException } from '@nestjs/common';
import { ServicesService } from './services.service';

/**
 * 服务域单测（P2 · 验收判据 V8「接口导入幂等」的机器可执行部分）
 *
 * 锁定导入语义：**UPSERT 只补空字段**
 * ① 重复导入同一批 → 不新增、不覆盖（created=0 / filled=0 / skipped=N）；
 * ② 已有非空字段永不被覆盖（人工配置优先）；
 * ③ `authMode='inherit'` 视同未配置，允许被导入值填充；
 * ④ 批内重复（同 method+path）只取首个。
 */
describe('ServicesService（接口导入幂等 / 转发规则冲突）', () => {
  let svc: ServicesService;
  let epRows: any[];
  let routeRows: any[];

  const service = {
    key: 'todo-service',
    name: '待办服务',
    kind: 'nest',
    repoDir: 'todo-service',
    healthPath: '/health',
    defaultPort: 6005,
    enabled: true,
    deletedAt: null,
  };

  beforeEach(() => {
    epRows = [];
    routeRows = [];

    const serviceRepo: any = {
      findOne: jest.fn(async () => service),
      count: jest.fn(async () => 1),
      find: jest.fn(async () => [service]),
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (x: any) => x),
    };
    const endpointRepo: any = {
      findOne: jest.fn(
        async ({ where }: any) =>
          epRows.find(
            (r) =>
              r.serviceKey === where.serviceKey &&
              r.method === where.method &&
              r.pathPattern === where.pathPattern,
          ) || null,
      ),
      find: jest.fn(async () => epRows),
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (row: any) => {
        if (!epRows.includes(row)) epRows.push(row);
        return row;
      }),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    let routeSeq = 0;
    const routeRepo: any = {
      // 简化：忽略 where 过滤，返回全部（用例内只有一个服务）
      find: jest.fn(async () => routeRows),
      findOne: jest.fn(async ({ where }: any) => routeRows.find((r) => r.id === where.id) || null),
      // 主键由仓储生成（真实 TypeORM 亦如此），否则"排除自身"的冲突检测在 mock 下失效
      create: jest.fn((x: any) => ({ id: `r-${++routeSeq}`, ...x })),
      save: jest.fn(async (row: any) => {
        if (!routeRows.includes(row)) routeRows.push(row);
        return row;
      }),
      delete: jest.fn(async () => ({ affected: 1 })),
    };
    const serviceEnvRepo: any = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
    const envRepo: any = { find: jest.fn(async () => []), findOne: jest.fn(async () => ({ envId: 'dev' })) };
    // 主机管理（服务指向的地址来源；单测里不登记任何主机 → 解析应 fail-fast）
    const hostRepo: any = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };
    const legacyModuleRepo: any = { find: jest.fn(async () => []) };
    const legacyRouteRepo: any = { find: jest.fn(async () => []) };
    const configService: any = { get: jest.fn(() => undefined) };
    // 部署动作依赖（本机 pm2 + 命令执行），单测中不实际重启
    const pm2Probe: any = jest.fn() as any;
    const command: any = jest.fn() as any;

    svc = new ServicesService(
      serviceRepo,
      routeRepo,
      endpointRepo,
      serviceEnvRepo,
      envRepo,
      hostRepo,
      legacyModuleRepo,
      legacyRouteRepo,
      configService,
      pm2Probe,
      command,
    );
  });

  const importOnce = (items: any[]) =>
    svc.importEndpoints('todo-service', { items, source: 'openapi' });

  it('首次导入 → 全部新增', async () => {
    const res = await importOnce([
      { method: 'GET', pathPattern: '/api/todo' },
      { method: 'POST', pathPattern: '/api/todo' },
    ]);
    expect(res).toMatchObject({ total: 2, created: 2, filled: 0, skipped: 0 });
    expect(epRows).toHaveLength(2);
    expect(epRows[0].source).toBe('openapi');
  });

  it('重复导入同一批 → 幂等：不新增、不覆盖（created=0/filled=0/skipped=N）', async () => {
    const items = [
      { method: 'GET', pathPattern: '/api/todo', summary: '列表' },
      { method: 'POST', pathPattern: '/api/todo', summary: '创建' },
    ];
    await importOnce(items);
    const second = await importOnce(items);

    expect(second).toMatchObject({ created: 0, filled: 0, skipped: 2 });
    expect(epRows).toHaveLength(2);
  });

  it('只补空字段：非空的人工配置不被覆盖，空字段被补齐', async () => {
    await importOnce([{ method: 'GET', pathPattern: '/api/todo', summary: '人工摘要' }]);

    const res = await importOnce([
      {
        method: 'GET',
        pathPattern: '/api/todo',
        summary: '来自 OpenAPI 的摘要',
        permissionCode: 'todo:read',
      },
    ]);

    expect(res).toMatchObject({ created: 0, filled: 1, skipped: 0 });
    const row = epRows[0];
    expect(row.summary).toBe('人工摘要'); // 非空 → 不覆盖
    expect(row.permissionCode).toBe('todo:read'); // 空 → 补齐
    expect(res.details[0].fields).toEqual(['permissionCode']);
  });

  it('authMode=inherit 视同未配置，可被导入值填充一次（其后不再覆盖）', async () => {
    await importOnce([{ method: 'GET', pathPattern: '/api/todo', authMode: 'inherit' }]);
    expect(epRows[0].authMode).toBe('inherit');

    const res1 = await importOnce([
      { method: 'GET', pathPattern: '/api/todo', authMode: 'jwt' },
    ]);
    expect(res1.filled).toBe(1);
    expect(epRows[0].authMode).toBe('jwt');

    const res2 = await importOnce([
      { method: 'GET', pathPattern: '/api/todo', authMode: 'none' },
    ]);
    expect(res2).toMatchObject({ filled: 0, skipped: 1 });
    expect(epRows[0].authMode).toBe('jwt');
  });

  it('批内重复（同 method+path）只取首个，其余跳过', async () => {
    const res = await importOnce([
      { method: 'GET', pathPattern: '/api/todo', summary: 'first' },
      { method: 'GET', pathPattern: '/api/todo', summary: 'second' },
    ]);
    expect(res).toMatchObject({ created: 1, skipped: 1 });
    expect(epRows).toHaveLength(1);
    expect(epRows[0].summary).toBe('first');
  });

  it('转发规则：同前缀冲突阻断；前缀包含关系只给告警（priority 决定匹配序）', async () => {
    await svc.createRoute('todo-service', { pathPrefix: '/api/todo', priority: 10 });

    await expect(
      svc.createRoute('todo-service', { pathPrefix: '/api/todo', priority: 20 }),
    ).rejects.toThrow(ConflictException);

    const res = await svc.createRoute('todo-service', { pathPrefix: '/api/todo/v2', priority: 5 });
    expect(res.warnings).toEqual([{ pathPrefix: '/api/todo', priority: 10, relation: 'shorter' }]);
    expect(routeRows).toHaveLength(2);
  });

  it('探活：未配置目标主机时明确报错（不回落本机，B4）', async () => {
    await expect(svc.probeHealth('todo-service', 'dev')).rejects.toThrow(/未配置目标主机/);
  });
});
