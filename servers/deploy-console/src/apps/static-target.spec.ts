import {
  defaultStaticRoot,
  describeTarget,
  envArtifactsRel,
  envConfigKey,
  resolveStaticTarget,
  sshPrefix,
} from './static-target';

/** 配置桩：只认传入的键值对 */
function cfg(map: Record<string, string>) {
  return (k: string) => map[k];
}

describe('静态落点解析（诊断 #3：落点是环境的一等属性）', () => {
  it('未配置 → 回落本机发布目录（与修复前逐字节一致，零破坏）', () => {
    const t = resolveStaticTarget('dev', cfg({}), '/data/web_system');
    expect(t).toEqual({
      env: 'dev',
      root: '/data/web_system/servers/gateway/public',
      sshTarget: null,
    });
  });

  it('prod 外置静态根 + 远端机器（线上真实配置形态）', () => {
    const t = resolveStaticTarget(
      'prod',
      cfg({
        STATIC_PUBLIC_ROOT_PROD: '/data/web_system_static/public',
        STATIC_SSH_TARGET_PROD: 'root@106.52.176.246',
      }),
      '/data/web_system',
    );
    expect(t.root).toBe('/data/web_system_static/public');
    expect(t.sshTarget).toBe('root@106.52.176.246');
    expect(describeTarget(t)).toBe('root@106.52.176.246:/data/web_system_static/public');
  });

  it('只配静态根不配机器 → 视为本机（同机多静态根场景）', () => {
    const t = resolveStaticTarget(
      'staging',
      cfg({ STATIC_PUBLIC_ROOT_STAGING: '/data/staging_public' }),
      '/ws',
    );
    expect(t.sshTarget).toBeNull();
    expect(t.root).toBe('/data/staging_public');
  });

  it('环境级配置优先于全局兜底', () => {
    const t = resolveStaticTarget(
      'prod',
      cfg({ STATIC_PUBLIC_ROOT: '/global', STATIC_PUBLIC_ROOT_PROD: '/prod-specific' }),
      '/ws',
    );
    expect(t.root).toBe('/prod-specific');
  });

  it('环境键归一化：staging-1 → STATIC_PUBLIC_ROOT_STAGING_1', () => {
    expect(envConfigKey('STATIC_PUBLIC_ROOT', 'staging-1')).toBe('STATIC_PUBLIC_ROOT_STAGING_1');
    const t = resolveStaticTarget(
      'staging-1',
      cfg({ STATIC_PUBLIC_ROOT_STAGING_1: '/data/s1' }),
      '/ws',
    );
    expect(t.root).toBe('/data/s1');
  });

  it('路径尾斜杠归一化，避免拼出 //', () => {
    const t = resolveStaticTarget('prod', cfg({ STATIC_PUBLIC_ROOT_PROD: '/data/pub/' }), '/ws');
    expect(t.root).toBe('/data/pub');
  });

  it('默认静态根与历史行为一致', () => {
    expect(defaultStaticRoot('/data/web_system')).toBe(
      '/data/web_system/servers/gateway/public',
    );
  });

  it('远端产物相对路径（posix）', () => {
    expect(envArtifactsRel('portal', 'prod')).toBe('static/modules/portal/prod');
  });

  it('ssh 前缀带 BatchMode（不可达时快速失败，不卡密码输入）', () => {
    expect(sshPrefix('root@1.2.3.4')).toContain('BatchMode=yes');
  });
});
