import {
  assertClusterConfigured,
  DEPLOY_MODE_ENV,
  DeployModeError,
  describeDeployMode,
  resolveDeployMode,
} from './deploy-mode';

describe('deploy-mode（部署形态判定）', () => {
  describe('resolveDeployMode', () => {
    it('显式声明 cluster', () => {
      const r = resolveDeployMode({ DEPLOY_MODE: 'cluster' });
      expect(r).toMatchObject({ mode: 'cluster', source: 'explicit' });
      expect(r.reasons.join()).toContain('DEPLOY_MODE=cluster');
    });

    it('显式声明 standalone', () => {
      const r = resolveDeployMode({ DEPLOY_MODE: 'standalone' });
      expect(r).toMatchObject({ mode: 'standalone', source: 'explicit' });
    });

    it('未声明时走平台默认 cluster，并在依据里提示单机部署要显式声明', () => {
      const r = resolveDeployMode({});
      expect(r).toMatchObject({ mode: 'cluster', source: 'default' });
      expect(r.reasons.join()).toContain('standalone');
    });

    it('空串 / 纯空白视为未声明（不因首尾空格改变形态）', () => {
      expect(resolveDeployMode({ DEPLOY_MODE: '   ' }).mode).toBe('cluster');
      expect(resolveDeployMode({ DEPLOY_MODE: '' }).source).toBe('default');
    });

    it('拼错的值拒绝启动（不静默按默认值运行）', () => {
      expect(() => resolveDeployMode({ DEPLOY_MODE: 'clustr' })).toThrow(DeployModeError);
    });

    it('大小写不对也拒绝启动（区分大小写，避免「以为声明了其实没有」）', () => {
      expect(() => resolveDeployMode({ DEPLOY_MODE: 'Cluster' })).toThrow(DeployModeError);
      expect(() => resolveDeployMode({ DEPLOY_MODE: 'STANDALONE' })).toThrow(DeployModeError);
    });

    /**
     * 🔴 反漂移 D1 的核心断言：形态**不得**随本服务凭证变化。
     *
     * 2026-11-03 实测 prod：ai/user/upload/system-service 有 INTERNAL_API_KEY，
     * content-hub / gateway / auth-service 没有。若形态由凭证推导，同一集群会判出两种形态。
     * 一旦有人把实现改成「有 key 就是集群」，下面两条必须变红。
     */
    it('形态不随本服务凭证漂移：有 / 无 INTERNAL_API_KEY 都得到同一形态', () => {
      const withKey = resolveDeployMode({ INTERNAL_API_KEY: 'k' });
      const withoutKey = resolveDeployMode({});
      expect(withKey.mode).toBe('cluster');
      expect(withoutKey.mode).toBe('cluster');
      expect(withKey.mode).toBe(withoutKey.mode);
      expect(withKey.source).toBe(withoutKey.source);
    });

    it('凭证同样不影响 standalone 声明（声明优先于一切推导）', () => {
      const r = resolveDeployMode({ DEPLOY_MODE: 'standalone', INTERNAL_API_KEY: 'k' });
      expect(r.mode).toBe('standalone');
    });
  });

  describe('assertClusterConfigured（cluster 闸门）', () => {
    it('权威值来自配置表 → 通过', () => {
      expect(() => assertClusterConfigured('system_configs')).not.toThrow();
    });

    it('权威值来自 system-service 的 env（有人显式配过）→ 通过', () => {
      expect(() => assertClusterConfigured('env')).not.toThrow();
    });

    /**
     * 🔴 D3：system-service 自己也在用平台默认 = 集群里没人配过该路径。
     * 放行会让所有服务静默改用单机默认路径（数据分裂），必须拦。
     */
    it('权威源是平台默认值 → 拒绝启动，且说清「没人配过」的后果', () => {
      expect(() => assertClusterConfigured('default', '上传根目录')).toThrow(
        /上传根目录[\s\S]*数据分裂/,
      );
    });

    /** 🔴 D2：根本没取到权威值 —— 不允许回落到单机路径 */
    it('没取到权威值 → 拒绝启动，且明说不允许回落', () => {
      expect(() => assertClusterConfigured(undefined, '上传根目录')).toThrow(
        /不允许回落/,
      );
    });

    it('报错文案给出两条修复路径（补配置 / 声明 standalone），不只是抛一句失败', () => {
      expect(() => assertClusterConfigured('default')).toThrow(/DEPLOY_MODE=standalone/);
      expect(() => assertClusterConfigured(undefined)).toThrow(/DEPLOY_MODE=standalone/);
    });
  });

  describe('describeDeployMode', () => {
    it('启动日志能说清形态、来源与依据（排查「为什么是这个形态」）', () => {
      const line = describeDeployMode(resolveDeployMode({}));
      expect(line).toContain('cluster');
      expect(line).toContain('平台默认');
      expect(line).toContain(DEPLOY_MODE_ENV);
    });
  });
});
