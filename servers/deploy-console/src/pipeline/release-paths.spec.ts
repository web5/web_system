import * as path from 'path';
import {
  moduleArtifactsRoot,
  moduleArtifactDir,
  moduleArtifactEntry,
  moduleArtifactUrl,
  manifestUrl,
  toCommitId,
  CDN_ROOT,
  cdnAssetDir,
  cdnAssetUrl,
  cdnCommonUrl,
  cdnLayoutMode,
  isSafeSegment,
  resolveCdnTarget,
} from './release-paths';

describe('release-paths（静态产物路径收口）', () => {
  const ws = '/release';

  it('产物根落在 <ws>/servers/gateway/public/static/modules/<key>', () => {
    expect(moduleArtifactsRoot(ws, 'admin')).toBe(
      path.join(ws, 'servers', 'gateway', 'public', 'static', 'modules', 'admin'),
    );
  });

  it('产物目录与入口文件按版本定位', () => {
    const dir = moduleArtifactDir(ws, 'admin', 'abc1234');
    expect(dir).toBe(path.join(moduleArtifactsRoot(ws, 'admin'), 'abc1234'));
    expect(moduleArtifactEntry(ws, 'admin', 'abc1234')).toBe(path.join(dir, 'index.js'));
  });

  it('产物 HTTP URL 指向 gateway 静态路径（verify HEAD 探活用）', () => {
    expect(moduleArtifactUrl('http://localhost:6000', 'admin', 'abc1234')).toBe(
      'http://localhost:6000/static/modules/admin/abc1234/index.js',
    );
  });

  it('manifest URL 指向 __manifest__', () => {
    expect(manifestUrl('http://localhost:6000')).toBe('http://localhost:6000/__manifest__');
  });
});

/**
 * 入参 commit 归一化的防回归测试。
 *
 * 背景（线上已复现）：控制台「Commit」下拉的数据来自版本列表，值是**完整版本引用**
 * `default/91f744b`；提交接口按纯短哈希设计 → 直接透传会 400「目标 commit 含非法字符」。
 * 归一化后：完整引用取末段，纯哈希原样，空值=分支最新。
 */
describe('toCommitId（入参 commit 归一化）', () => {
  it('完整版本引用 → 取末段纯 commit', () => {
    expect(toCommitId('default/91f744b')).toBe('91f744b');
    expect(toCommitId('v5-e2e/abc1234')).toBe('abc1234');
  });

  it('纯 commit / 前后空格 → 原样（去空格）', () => {
    expect(toCommitId('91f744b')).toBe('91f744b');
    expect(toCommitId(' 91f744b ')).toBe('91f744b');
  });

  it('空值 → undefined（= 走分支最新提交）', () => {
    expect(toCommitId(undefined)).toBeUndefined();
    expect(toCommitId(null)).toBeUndefined();
    expect(toCommitId('')).toBeUndefined();
    expect(toCommitId('   ')).toBeUndefined();
  });

  it('归一化结果应能通过提交白名单（不含 /）', () => {
    const re = /^[A-Za-z0-9._-]{4,64}$/;
    expect(re.test(toCommitId('default/91f744b') as string)).toBe(true);
  });
});

/**
 * Phase 2 CDN 布局（`<env>/<app>/<commit>`）。
 *
 * 🔴 核心回归：顺序必须 `<env>` 在 `<app>` 之前。历史布局是
 * `static/modules/<app>/<env>/<commit>`，只换根不换顺序时 GC 扫到的下一级
 * 恰好是 commit 哈希，能通过 `isSafeVersionName` 真删成功 —— 静默删错目录。
 * 故这里把顺序**逐个断言**，任何人调回 `<app>/<env>` 立刻红。
 */
describe('cdnAssetDir（<env>/<app>/<commit> 布局）', () => {
  it('顺序是 env 在前、app 在后（与 legacy <app>/<env> 相反）', () => {
    expect(cdnAssetDir('/data/cdn', 'prod', 'portal', '624bfa46')).toBe(
      '/data/cdn/prod/portal/624bfa46',
    );
    // 反向断言：绝不能出现 legacy 顺序
    expect(cdnAssetDir('/data/cdn', 'prod', 'portal', '624bfa46')).not.toBe(
      '/data/cdn/portal/prod/624bfa46',
    );
  });

  it('root 缺省 → /data/cdn；尾斜杠归一', () => {
    expect(cdnAssetDir(undefined, 'dev', 'admin', 'abc1234')).toBe(
      `${CDN_ROOT}/dev/admin/abc1234`,
    );
    expect(cdnAssetDir('/data/cdn/', 'dev', 'admin', 'abc1234')).toBe(
      '/data/cdn/dev/admin/abc1234',
    );
  });

  it('非法路径段一律 throw（不静默拼接）', () => {
    expect(() => cdnAssetDir('/data/cdn', 'prod/../dev', 'portal', 'abc1234')).toThrow();
    expect(() => cdnAssetDir('/data/cdn', 'prod', '..', 'abc1234')).toThrow();
    expect(() => cdnAssetDir('/data/cdn', 'prod', 'portal', 'default/624bfa46')).toThrow();
    expect(() => cdnAssetDir('/data/cdn', '', 'portal', 'abc1234')).toThrow();
  });

  it('完整版本引用必须先经 toCommitId 归一化才能进路径', () => {
    expect(() => cdnAssetDir('/data/cdn', 'prod', 'portal', 'default/624bfa46')).toThrow();
    const commit = toCommitId('default/624bfa46') as string;
    expect(cdnAssetDir('/data/cdn', 'prod', 'portal', commit)).toBe(
      '/data/cdn/prod/portal/624bfa46',
    );
  });
});

describe('cdnAssetUrl / cdnCommonUrl', () => {
  it('资产 URL 与磁盘目录同构（order 一致）', () => {
    expect(cdnAssetUrl('https://kedouai.com/cdn/', 'prod', 'portal', '624bfa46')).toBe(
      'https://kedouai.com/cdn/prod/portal/624bfa46/index.js',
    );
    expect(cdnAssetUrl('https://dev.kedouai.com/cdn', 'dev', 'admin', 'abc1234', 'chunks/a.js')).toBe(
      'https://dev.kedouai.com/cdn/dev/admin/abc1234/chunks/a.js',
    );
  });

  it('origin 为空 / 相对路径 → throw（必须是带域名的完整 URL base）', () => {
    expect(() => cdnAssetUrl('', 'prod', 'portal', 'abc1234')).toThrow();
    expect(() => cdnAssetUrl('   ', 'prod', 'portal', 'abc1234')).toThrow();
  });

  it('fileName 不得跳出目录', () => {
    expect(() => cdnAssetUrl('https://x.com/cdn', 'prod', 'portal', 'abc1234', '../a.js')).toThrow();
  });

  it('公共依赖分 libs / pub 两组，未知分组 throw', () => {
    expect(cdnCommonUrl('https://kedouai.com/cdn/', 'libs', 'vue.js')).toBe(
      'https://kedouai.com/cdn/common/libs/vue.js',
    );
    expect(cdnCommonUrl('https://kedouai.com/cdn', 'pub', 'img/a.png')).toBe(
      'https://kedouai.com/cdn/common/pub/img/a.png',
    );
    // @ts-expect-error 故意传非法分组
    expect(() => cdnCommonUrl('https://kedouai.com/cdn', 'other', 'a.js')).toThrow();
  });
});

describe('isSafeSegment', () => {
  it('接受 commit / env / app 常见形态', () => {
    for (const s of ['prod', 'dev', 'portal', 'admin', '624bfa46', 'v5-e2e', 'a_b.c']) {
      expect(isSafeSegment(s)).toBe(true);
    }
  });

  it('拒绝空 / 点 / 上级目录 / 含斜杠或空格', () => {
    for (const s of ['', '   ', '.', '..', 'a/b', 'a b', 'default/624bfa46']) {
      expect(isSafeSegment(s)).toBe(false);
    }
  });
});

describe('resolveCdnTarget（投递 / 校验 / GC 同源解析）', () => {
  const getter = (bag: Record<string, string | undefined>) => (k: string) =>
    bag[k];

  it('默认 → /data/cdn，本机（sshTarget=null）', () => {
    expect(resolveCdnTarget(getter({}), 'prod')).toEqual({
      env: 'prod',
      root: '/data/cdn',
      sshTarget: null,
    });
  });

  it('环境级键优先于全局键', () => {
    const get = getter({
      CDN_ROOT: '/data/cdn',
      CDN_ROOT_PROD: '/data/cdn_prod/',
      CDN_SSH_TARGET: 'ops@1.2.3.4',
      CDN_SSH_TARGET_PROD: 'root@cdn-entry.local',
    });
    expect(resolveCdnTarget(get, 'prod')).toEqual({
      env: 'prod',
      root: '/data/cdn_prod',
      sshTarget: 'root@cdn-entry.local',
    });
    // 另一环境回落全局键，证明不是「读了环境键就当全局」
    expect(resolveCdnTarget(get, 'dev')).toEqual({
      env: 'dev',
      root: '/data/cdn',
      sshTarget: 'ops@1.2.3.4',
    });
  });

  it('env 大小写 / 连字符 → 键后缀归一（staging-1 → STAGING_1）', () => {
    const get = getter({ CDN_ROOT_STAGING_1: '/data/cdn_s1' });
    expect(resolveCdnTarget(get, 'staging-1').root).toBe('/data/cdn_s1');
  });
});

describe('cdnLayoutMode（默认零变化的开关）', () => {
  const getter = (bag: Record<string, string | undefined>) => (k: string) =>
    bag[k];

  it('未配置 → legacy（存量行为逐字节不变）', () => {
    expect(cdnLayoutMode(getter({}))).toBe('legacy');
    expect(cdnLayoutMode(getter({ CDN_LAYOUT_MODE: '  ' }))).toBe('legacy');
  });

  it('显式 legacy / cdn 均识别（忽略大小写）', () => {
    expect(cdnLayoutMode(getter({ CDN_LAYOUT_MODE: 'legacy' }))).toBe('legacy');
    expect(cdnLayoutMode(getter({ CDN_LAYOUT_MODE: 'CDN' }))).toBe('cdn');
  });

  it('拼错 → throw（不静默回退 legacy，否则假成功）', () => {
    expect(() => cdnLayoutMode(getter({ CDN_LAYOUT_MODE: 'cnd' }))).toThrow();
  });
});
