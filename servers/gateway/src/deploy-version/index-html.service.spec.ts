import { existsSync } from 'fs';
import { IndexHtmlService } from './index-html.service';

/**
 * 清单读取源单测（2026-09-28 **停用 legacy**）。
 *
 * 背景：控制台的版本切换（`AppsService.switchVersion`）早就只写新表
 * `deploy_app_env_versions`，而 gateway 还从 `deploy_deployments` 读前端版本
 * → 两轨漂移（表现：控制台显示已切到新版本，页面仍加载旧产物）。
 *
 * 这里锁死三条规则：
 * 1. 前端清单（byEnv + 兼容字段 modules）**只读 NEW 域**；
 * 2. 新表读失败 / 未匹配站点时**不再回落旧表**（回落只会掩盖漂移）；
 * 3. `DEPLOY_LEGACY_READ=1` 是**唯一**仍走旧表的通道（应急开关）。
 */
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ mtimeMs: 1 })),
  readFileSync: jest.fn(() => '<html><head></head><body></body></html>'),
}));
jest.mock('../static/public-root', () => ({ PUBLIC_ROOT: '/public' }));

const APP_ROWS = [
  { key: 'admin', deployMode: 'env-dir' },
  { key: 'portal', deployMode: 'env-dir' },
  // 基座：site-version，不纳入 env 切换（Q107）
  { key: 'shell', deployMode: 'site-version' },
];
const VERSION_ROWS = [
  { appKey: 'admin', envId: 'dev', currentVersion: '3d5ce61' },
  { appKey: 'portal', envId: 'dev', currentVersion: '7a6be04' },
  { appKey: 'shell', envId: 'dev', currentVersion: '7a6be04' },
];
const SITE = { key: 'dev', host: 'dev.kedouai.com', defaultEnvId: 'dev', switchable: true };
const ENV_ROWS = [{ envId: 'dev', name: '主开发环境', isProd: false }];

function makeRepo() {
  return { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
}

function build(opts: { legacyRead?: boolean; preloadOff?: boolean } = {}) {
  const cfg = {
    get: (k: string) => {
      if (k === 'DEPLOY_ENV_ID') return 'dev';
      if (k === 'DEPLOY_LEGACY_READ' && opts.legacyRead) return '1';
      if (k === 'MF_PRELOAD' && opts.preloadOff) return '0';
      return '';
    },
  };
  const deployRepo = makeRepo();
  const moduleRepo = makeRepo();
  const canaryRepo = makeRepo();
  const siteRepo = makeRepo();
  const envRepo = makeRepo();
  const appRepo = makeRepo();
  const appVersionRepo = makeRepo();

  appRepo.find.mockResolvedValue(APP_ROWS);
  appVersionRepo.find.mockResolvedValue(VERSION_ROWS);
  appVersionRepo.findOne.mockImplementation(({ where }: any) =>
    Promise.resolve(
      VERSION_ROWS.find((v) => v.appKey === where.appKey && v.envId === where.envId) ?? null,
    ),
  );
  siteRepo.find.mockResolvedValue([SITE]);
  envRepo.find.mockResolvedValue(ENV_ROWS);

  const svc = new IndexHtmlService(
    cfg as any,
    deployRepo as any,
    moduleRepo as any,
    canaryRepo as any,
    siteRepo as any,
    envRepo as any,
    appRepo as any,
    appVersionRepo as any,
  );
  return { svc, deployRepo, moduleRepo, siteRepo, envRepo, appRepo, appVersionRepo };
}

const req = { headers: { host: 'dev.kedouai.com' }, query: {} };

describe('IndexHtmlService.buildManifest（读取源 = NEW 域）', () => {
  it('站点匹配：byEnv 用 env-dir 固定入口，兼容字段 modules 由新表合成整包目录', async () => {
    const { svc } = build();
    const m = await svc.buildManifest(req);

    expect(m.source).toBe('new');
    expect(m.site).toBe('dev');
    expect(m.byEnv.dev.admin.entry).toBe('/static/modules/admin/dev/index.js');
    expect(m.byEnv.dev.portal.entry).toBe('/static/modules/portal/dev/index.js');
    // 基座不进 byEnv（Q107）
    expect(m.byEnv.dev.shell).toBeUndefined();

    const admin = m.modules.find((x: any) => x.name === 'admin');
    expect(admin.version).toBe('3d5ce61');
    expect(admin.entry).toBe('/static/modules/admin/dev/3d5ce61/index.js');
    expect(admin.assetsBase).toBe('/static/modules/admin/dev/3d5ce61/');
  });

  it('未匹配站点（IP / localhost 直连）：退化为单环境，仍只从新表组装', async () => {
    const { svc, siteRepo, deployRepo } = build();
    siteRepo.find.mockResolvedValue([]); // Host 无站点
    const m = await svc.buildManifest({ headers: { host: '127.0.0.1' }, query: {} });

    expect(m.source).toBe('new:nosite');
    expect(m.envs).toEqual([{ id: 'dev', name: 'dev', isProd: false }]);
    expect(m.byEnv.dev.admin.entry).toBe('/static/modules/admin/dev/index.js');
    // 关键：不回落旧表
    expect(deployRepo.findOne).not.toHaveBeenCalled();
  });

  it('新表读失败：返回空清单（source=new:error），不回落 legacy', async () => {
    const { svc, appVersionRepo, deployRepo } = build();
    appVersionRepo.find.mockRejectedValue(new Error('db down'));
    const m = await svc.buildManifest(req);

    expect(m.source).toBe('new:error');
    expect(m.modules).toEqual([]);
    expect(m.byEnv).toEqual({});
    expect(deployRepo.findOne).not.toHaveBeenCalled();
  });
});

/**
 * 首屏 preload 注入（2026-09-28 优化 P0-1）。
 *
 * 背景：模块入口 gzip 后仍有 ~500KB，而基座是「shell 启动完才发起模块请求」的
 * 串行瀑布，下载期间屏幕一片空白。这里把服务端该注入什么锁死：
 * 1. **只预载本次命中的那个模块**，URL 与运行时请求逐字一致（含两跳：无版本指针 + 版本化整包）；
 * 2. 命中不了模块（/login、未知路径）→ 不注入任何东西；
 * 3. Cookie 选过环境 → 按该环境预载（预载错环境等于白下载 500KB）；
 * 4. `MF_PRELOAD=0` 应急开关一键关闭。
 */
describe('IndexHtmlService 首屏 preload 注入', () => {
  /** 取预载标签（避免模块内部方法暴露造成的公开接口污染） */
  const tagsOf = async (svc: IndexHtmlService, r: any) => {
    const m = await svc.buildManifest(r);
    return (svc as any).buildPreloadTags(m, r);
  };

  it('/admin 路由：预载版本化整包 + 无版本指针 + 样式（均为同源绝对路径）', async () => {
    const { svc } = build();
    const tags = await tagsOf(svc, { ...req, path: '/admin/users' });

    expect(tags).toContain('<link rel="preload" href="/static/modules/admin/dev/3d5ce61/index.js" as="script">');
    expect(tags).toContain('<link rel="preload" href="/static/modules/admin/dev/index.js" as="script">');
    expect(tags).toContain('<link rel="preload" href="/static/modules/admin/dev/index.css" as="style">');
    // 只预载命中的模块，不牵连 portal
    expect(tags).not.toContain('portal');
  });

  it('/ 根路径：基座 router 会 redirect 到 portal，故预载 portal', async () => {
    const { svc } = build();
    const tags = await tagsOf(svc, { ...req, path: '/' });
    expect(tags).toContain('/static/modules/portal/dev/7a6be04/index.js');
    expect(tags).not.toContain('/static/modules/admin/');
  });

  it('/login 等非模块路径：不注入预载', async () => {
    const { svc } = build();
    expect(await tagsOf(svc, { ...req, path: '/login' })).toBe('');
    expect(await tagsOf(svc, { ...req, path: '/404' })).toBe('');
  });

  it('Cookie 选过环境 → 按该环境预载（避免预载到用不上的版本）', async () => {
    const { svc, envRepo, appVersionRepo } = build();
    envRepo.find.mockResolvedValue([
      { envId: 'dev', name: '开发', isProd: false },
      { envId: 'staging', name: '预发', isProd: false },
    ]);
    appVersionRepo.find.mockResolvedValue([
      { appKey: 'admin', envId: 'dev', currentVersion: '3d5ce61' },
      { appKey: 'admin', envId: 'staging', currentVersion: 'aaa1111' },
    ]);
    const tags = await tagsOf(svc, {
      ...req,
      path: '/admin',
      headers: { ...req.headers, cookie: 'kedou_env=staging; foo=1' },
    });
    expect(tags).toContain('/static/modules/admin/staging/aaa1111/index.js');
    expect(tags).not.toContain('/static/modules/admin/dev/');
  });

  it('MF_PRELOAD=0（应急开关）→ 不注入', async () => {
    const { svc } = build({ preloadOff: true });
    expect(await tagsOf(svc, { ...req, path: '/admin' })).toBe('');
  });

  it('清单为空（我的模块都没登记）→ 不注入，行为与改造前一致', async () => {
    const { svc, appVersionRepo } = build();
    appVersionRepo.find.mockResolvedValue([]);
    expect(await tagsOf(svc, { ...req, path: '/admin' })).toBe('');
  });
});

describe('IndexHtmlService（legacy 应急通道）', () => {
  it('DEPLOY_LEGACY_READ=1：只从 deploy_deployments 读，路径为旧扁平布局', async () => {
    const { svc, deployRepo, moduleRepo } = build({ legacyRead: true });
    moduleRepo.find.mockResolvedValue([{ key: 'admin', type: 'micro-frontend' }]);
    deployRepo.findOne.mockResolvedValue({ currentVersion: 'd9889ff' });

    const m = await svc.buildManifest(req);
    expect(m.source).toBe('legacy');
    expect(m.modules[0].entry).toBe('/static/modules/admin/d9889ff/index.js');
    expect(m.byEnv.dev.admin.entry).toBe('/static/modules/admin/d9889ff/index.js');
  });
});

describe('IndexHtmlService.resolveModuleVersion（/__version__ 端点）', () => {
  it('走新表：返回 <app>/<env>/<version>/ 整包目录', async () => {
    const { svc } = build();
    const r = await svc.resolveModuleVersion('admin', req);
    expect(r).toMatchObject({
      env: 'dev',
      version: '3d5ce61',
      entry: '/static/modules/admin/dev/3d5ce61/index.js',
      assetsBase: '/static/modules/admin/dev/3d5ce61/',
      source: 'new',
    });
  });

  it('新表无指针 → version 为 undefined（不再从旧表兜底）', async () => {
    const { svc } = build();
    const r = await svc.resolveModuleVersion('auth-service', req);
    expect(r.version).toBeUndefined();
    expect(r.entry).toBeNull();
  });
});

describe('IndexHtmlService 基座 shell 版本目录', () => {
  it('停用 legacy 后从 deploy_app_env_versions 读（static/modules/shell/<env>/<version>/）', async () => {
    const { svc, appVersionRepo } = build();
    appVersionRepo.findOne.mockResolvedValue({ appKey: 'shell', envId: 'dev', currentVersion: '7a6be04' });
    const file = await (svc as any).resolveShellHtmlFile();
    expect(file).toBe('/public/static/modules/shell/dev/7a6be04/index.html');
  });

  it('新表无 shell 指针 → 退回固定路径 shell/index.html', async () => {
    const { svc, appVersionRepo } = build();
    appVersionRepo.findOne.mockResolvedValue(null);
    const file = await (svc as any).resolveShellHtmlFile();
    expect(file).toBe('/public/shell/index.html');
  });
});

/**
 * 基座静态资源 `/shell/*`（wb-issues rtqmct）。
 *
 * 背景：html 走版本目录，而资源走 ServeStatic 固定目录 → 只投一处就 404、
 * 基座 JS 加载失败。这里锁死「资源与 html 同源」以及老部署的回落行为。
 */
describe('IndexHtmlService.resolveShellAssetPath（/shell/* 与 html 同源）', () => {
  beforeEach(() => {
    (existsSync as jest.Mock).mockReset();
    (existsSync as jest.Mock).mockReturnValue(true);
  });

  it('有指针 → 版本目录（与 html 同源），不再依赖固定目录', async () => {
    const { svc } = build();
    const file = await svc.resolveShellAssetPath('/shell/assets/index.abc123.js');
    expect(file).toBe('/public/static/modules/shell/dev/7a6be04/assets/index.abc123.js');
  });

  it('无指针（老部署）→ 回落固定目录 public/shell/', async () => {
    const { svc, appVersionRepo } = build();
    appVersionRepo.findOne.mockResolvedValue(null);
    const file = await svc.resolveShellAssetPath('/shell/assets/index.abc123.js');
    expect(file).toBe('/public/shell/assets/index.abc123.js');
  });

  it('版本目录缺该文件 → 返回 null（由调用方回落固定目录）', async () => {
    const { svc } = build();
    (existsSync as jest.Mock).mockReturnValue(false);
    const file = await svc.resolveShellAssetPath('/shell/assets/index.new.js');
    expect(file).toBeNull();
  });

  it('目录穿越 / 非法路径 → 返回 null', async () => {
    const { svc } = build();
    expect(await svc.resolveShellAssetPath('/shell/../../etc/passwd')).toBeNull();
    expect(await svc.resolveShellAssetPath('/shell/../secret.txt')).toBeNull();
    expect(await svc.resolveShellAssetPath('/shell/')).toBeNull();
    expect(await svc.resolveShellAssetPath('/shell//abs/path.js')).toBeNull();
  });
});
