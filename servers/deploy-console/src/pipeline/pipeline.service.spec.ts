import * as path from 'path';
import { artifactsDir, deployRootAbs, deployTargetAbs } from './release-paths';
import {
  resolveStageCwd,
  isDeletablePipeline,
  killShellProcess,
  resolveStageVars,
  resolveRunStages,
  isRollbackAnchor,
} from './pipeline.service';

/**
 * 执行记录删除状态门禁的防回归测试。
 *
 * 背景：历史「删除执行记录」被设计为纯清理（不动版本指针/产物），
 * 但 running/pending/pending-approval 中的实例若被删，正在执行的引擎还会
 * 回写状态/日志到已删行，产生幽灵更新。此测试锁定「仅终态可删」。
 */
describe('resolveRunStages / isRollbackAnchor（v5 执行计划与回滚锚点）', () => {
  const v5nodes = () => [
    { kind: 'platform', key: 'git' },
    { kind: 'script', key: 'build', label: '构建' },
    { kind: 'platform', key: 'version' },
    { kind: 'platform', key: 'pointer' },
    { kind: 'script', key: 'verify', label: '探活', watchdog: true },
  ];

  it('无 nodes/steps → legacy 九阶段，回滚锚点=verify', () => {
    const plan = resolveRunStages({});
    expect(plan.mode).toBe('legacy');
    expect(plan.keys.length).toBe(9);
    expect(isRollbackAnchor('verify', plan)).toBe(true);
    expect(isRollbackAnchor('build', plan)).toBe(false);
  });

  it('legacy steps 子集 → keys=子集，verify 仍为回滚锚点', () => {
    const plan = resolveRunStages({ steps: ['check', 'pull', 'build', 'version', 'pointer', 'verify'] });
    expect(plan.mode).toBe('legacy');
    expect(plan.keys).toEqual(['check', 'pull', 'build', 'version', 'pointer', 'verify']);
    expect(isRollbackAnchor('verify', plan)).toBe(true);
  });

  it('v5 nodes → mode=nodes，keys 保序，watchdog 节点为回滚锚点', () => {
    const plan = resolveRunStages({ nodes: v5nodes() } as any);
    expect(plan.mode).toBe('nodes');
    expect(plan.keys).toEqual(['git', 'build', 'version', 'pointer', 'verify']);
    expect(plan.rollbackAnchor).toBe('verify');
    expect(isRollbackAnchor('verify', plan)).toBe(true);
    expect(isRollbackAnchor('pointer', plan)).toBe(false);
  });

  it('v5 nodes 无 watchdog → rollbackAnchor undefined（永不自动回滚）', () => {
    const nodes = [
      { kind: 'platform', key: 'git' },
      { kind: 'platform', key: 'version' },
      { kind: 'platform', key: 'pointer' },
    ];
    const plan = resolveRunStages({ nodes } as any);
    expect(plan.rollbackAnchor).toBeUndefined();
    expect(isRollbackAnchor('git', plan)).toBe(false);
  });

  it('submit 初始首节点=git（v5）', () => {
    const plan = resolveRunStages({ nodes: v5nodes() } as any);
    expect(plan.keys[0]).toBe('git');
  });
});

describe('isDeletablePipeline（执行记录删除状态门禁）', () => {
  it('终态（succeeded/failed/cancelled）可删', () => {
    for (const s of ['succeeded', 'failed', 'cancelled']) {
      expect(isDeletablePipeline(s)).toBe(true);
    }
  });

  it('运行/待执行/待审批不可删（须先停止或等待结束）', () => {
    for (const s of ['running', 'pending', 'pending-approval']) {
      expect(isDeletablePipeline(s)).toBe(false);
    }
  });
});

/**
 * 阶段命令工作目录的防回归测试。
 *
 * 背景：从旧 stageBuild 重构为命令驱动时，spawn 丢失了 cwd 设置，
 * 导致默认模板命令（如 `npx tsc -p tsconfig.json`）在 deploy-console 自身目录下执行，
 * 编译错目标。此测试锁定「命令必须在模块目录执行」这一约束。
 */
describe('resolveStageCwd（阶段命令工作目录）', () => {
  const ws = '/release';

  it('后端模块落在 servers/<dir>', () => {
    expect(resolveStageCwd(ws, 'backend', 'auth-service')).toBe(
      path.join(ws, 'servers', 'auth-service'),
    );
  });

  it('前端 / 微前端 / 小程序落在 apps/<dir>', () => {
    expect(resolveStageCwd(ws, 'frontend', 'admin')).toBe(path.join(ws, 'apps', 'admin'));
    expect(resolveStageCwd(ws, 'micro-frontend', 'portal')).toBe(path.join(ws, 'apps', 'portal'));
    expect(resolveStageCwd(ws, 'mini-app', 'mp')).toBe(path.join(ws, 'apps', 'mp'));
  });

  it('模块目录缺失时回落到发布目录（不落到 deploy-console 自身目录）', () => {
    expect(resolveStageCwd(ws, 'backend', undefined)).toBe(ws);
    expect(resolveStageCwd(ws, undefined, undefined)).toBe(ws);
  });
});

/**
 * 子进程组终止的防回归测试。
 *
 * 背景：runShell 用 `spawn('bash', ['-c', cmd])` 派生构建命令，超时/取消时
 * 原实现只 `child.kill()` 杀 bash 本身，vite / nest build 等**孙进程会残留**，
 * 继续占用端口与 CPU，下一次发布撞上残留进程（历史「6200 孤儿进程」同类根因）。
 * 修复：detached 进程组 + 负 pid 整组终止。此测试锁定「必须按进程组终止」。
 */
describe('killShellProcess（shell 子进程组终止）', () => {
  it('按负 pid 杀进程组（孙进程一并终止）', () => {
    const targeted: number[] = [];
    const result = killShellProcess(
      4321,
      (pid) => {
        targeted.push(pid);
      },
      () => {
        throw new Error('不应降级为只杀直接子进程');
      },
    );
    expect(targeted).toEqual([-4321]);
    expect(result).toBe('group');
  });

  it('负 pid 不支持时降级为终止直接子进程（如 Windows）', () => {
    const signals: string[] = [];
    const result = killShellProcess(
      4321,
      () => {
        throw new Error('ESRCH');
      },
      (signal) => {
        signals.push(signal);
      },
    );
    expect(signals).toEqual(['SIGKILL']);
    expect(result).toBe('child');
  });

  it('pid 缺失时不做任何终止', () => {
    const result = killShellProcess(0, () => undefined, () => undefined);
    expect(result).toBe('none');
  });
});

/**
 * 阶段变量的防回归测试（v4 M1）。
 *
 * 背景：v4 把 upload / restart / verify 等内置执行器下沉为「用户自配脚本」后，
 * 端口、pm2 进程名、产物路径不能再由平台代码隐式推导（历史：猜 5 个 pm2 候选名、
 * 产物路径硬编码、入口文件写死 index.js）。此测试锁定「全部显式下发为变量」。
 */
describe('resolveStageVars（阶段命令变量）', () => {
  const ws = '/release';

  it('后端：构建产物落在 servers/<dir>/dist，pm2 名取模块注册表字段', () => {
    const v = resolveStageVars({
      env: 'local',
      moduleKey: 'todo-service',
      moduleType: 'backend',
      dir: 'todo-service',
      pm2: 'web-todo',
      releaseWorkspace: ws,
      commitId: 'abc1234',
    });
    expect(v.BUILD_OUTPUT_DIR).toBe(path.join(ws, 'servers', 'todo-service', 'dist'));
    expect(v.PM2_NAME).toBe('web-todo');
    expect(v.MODULE_TYPE).toBe('backend');
  });

  it('前端 / 微前端：构建产物落在 apps/<dir>/dist', () => {
    const v = resolveStageVars({
      env: 'local',
      moduleKey: 'admin',
      moduleType: 'micro-frontend',
      dir: 'admin',
      releaseWorkspace: ws,
      commitId: 'abc1234',
    });
    expect(v.BUILD_OUTPUT_DIR).toBe(path.join(ws, 'apps', 'admin', 'dist'));
  });

  it('端口优先级：配置中心 > pm2 实际进程（配置中心是权威）', () => {
    const v = resolveStageVars({
      env: 'local',
      moduleKey: 'ai-agent',
      releaseWorkspace: ws,
      config: { PORT: '6010' },
      pm2Port: '6200', // 模拟 pm2_env 被污染
    });
    expect(v.PORT).toBe('6010');
  });

  it('配置中心无 PORT 时兜底读 pm2 实际进程', () => {
    const v = resolveStageVars({
      env: 'local',
      moduleKey: 'gateway',
      releaseWorkspace: ws,
      pm2Port: 6000,
    });
    expect(v.PORT).toBe('6000');
  });

  it('PUBLIC_PATH：模块 publicPath 优先，缺省回落 moduleKey（字段接线）', () => {
    const withCfg = resolveStageVars({
      env: 'dev',
      moduleKey: 'admin',
      publicPath: 'admin-portal',
      releaseWorkspace: ws,
      commitId: 'v1',
    });
    expect(withCfg.PUBLIC_PATH).toBe('admin-portal');
    expect(withCfg.ARTIFACT_DIR).toBe(
      path.join(ws, 'servers', 'gateway', 'public', 'static', 'modules', 'admin-portal', 'v1'),
    );

    const fallback = resolveStageVars({
      env: 'dev',
      moduleKey: 'admin',
      releaseWorkspace: ws,
      commitId: 'v1',
    });
    expect(fallback.PUBLIC_PATH).toBe('admin');
  });

  it('入口文件缺省 index.js；pm2 名缺省 web-<moduleKey>', () => {
    const v = resolveStageVars({ env: 'dev', moduleKey: 'portal', releaseWorkspace: ws });
    expect(v.ENTRY_FILE).toBe('index.js');
    expect(v.PM2_NAME).toBe('web-portal');
  });

  it('探活与清理变量：gateway 地址/TTL、保留数、受保护版本、删除策略', () => {
    const v = resolveStageVars({
      env: 'dev',
      moduleKey: 'admin',
      releaseWorkspace: ws,
      protectedVersions: ['v2', 'v3'],
      safeDelete: 'rm',
    });
    expect(v.GATEWAY_URL).toBe('http://localhost:6000');
    expect(v.GATEWAY_TTL_SEC).toBe('10');
    expect(v.KEEP_VERSIONS).toBe('5');
    expect(v.PROTECTED_VERSIONS).toBe('v2 v3');
    expect(v.WS_SAFE_DELETE).toBe('rm -rf');
  });

  it('删除策略缺省为 mv（规避批量删除审批，不写死在平台代码里）', () => {
    const v = resolveStageVars({ env: 'dev', moduleKey: 'admin', releaseWorkspace: ws });
    expect(v.WS_SAFE_DELETE).toBe('mv');
  });

  describe('P0 配置中心全量注入（2026-09-20）', () => {
    const base = { env: 'local', moduleKey: 'admin', releaseWorkspace: ws, commitId: 'abc1234' };

    it('配置中心的自定义键会注入脚本变量（此前只有 PORT 生效）', () => {
      const v = resolveStageVars({
        ...base,
        config: { ARTIFACT_SUBPATH: 'servers/gateway/public/static/modules/admin' },
      });
      expect(v.ARTIFACT_SUBPATH).toBe('servers/gateway/public/static/modules/admin');
    });

    it('配置可覆盖内置同名键（内置作为兜底）', () => {
      expect(resolveStageVars({ ...base, config: { ENTRY_FILE: 'main.js' } }).ENTRY_FILE).toBe('main.js');
      expect(resolveStageVars(base).ENTRY_FILE).toBe('index.js');
    });

    it('保护键不可被配置覆盖（平台语义真相源）', () => {
      const v = resolveStageVars({
        ...base,
        config: { COMMIT_ID: 'hacked', MODULE_KEY: 'other', DEPLOY_ENV: 'prod', RELEASE_DIR: '/tmp' },
      });
      expect(v.COMMIT_ID).toBe('abc1234');
      expect(v.MODULE_KEY).toBe('admin');
      expect(v.DEPLOY_ENV).toBe('local');
      expect(v.RELEASE_DIR).toBe(ws);
    });

    it('configInject=false 时回退旧行为（配置中心只影响 PORT）', () => {
      const v = resolveStageVars({ ...base, config: { PORT: '6010', ARTIFACT_SUBPATH: 'x' }, configInject: false });
      expect(v.PORT).toBe('6010');
      expect(v.ARTIFACT_SUBPATH).toBeUndefined();
    });

    it('PORT 仍保持「配置中心 > pm2 实际进程」的优先级', () => {
      expect(resolveStageVars({ ...base, config: { PORT: '6010' }, pm2Port: '6200' }).PORT).toBe('6010');
    });
  });

  describe('P3 pm2 入口 / 工作目录可配（2026-09-20）', () => {
    const be = {
      env: 'local',
      moduleKey: 'gateway',
      moduleType: 'backend',
      dir: 'gateway',
      releaseWorkspace: ws,
    };

    it('PM2_SCRIPT 缺省 dist/main.js（历史行为不变）', () => {
      expect(resolveStageVars(be).PM2_SCRIPT).toBe('dist/main.js');
    });

    it('服务管理配了 pm2Script 则用配置值', () => {
      expect(resolveStageVars({ ...be, pm2Script: 'dist/src/main.js' }).PM2_SCRIPT).toBe('dist/src/main.js');
    });

    it('PM2_CWD 缺省为 servers/<dir>（后端）/ apps/<dir>（前端）', () => {
      expect(resolveStageVars(be).PM2_CWD).toBe(path.join(ws, 'servers', 'gateway'));
      expect(resolveStageVars({ ...be, moduleType: 'micro-frontend' }).PM2_CWD).toBe(
        path.join(ws, 'apps', 'gateway'),
      );
    });

    it('配了 deployRoot 时 PM2_CWD 跟随部署根', () => {
      expect(resolveStageVars({ ...be, deployRoot: 'servers/gateway' }).PM2_CWD).toBe(
        path.join(ws, 'servers/gateway'),
      );
    });

    it('PM2_SCRIPT 可被配置中心覆盖（非保护键）', () => {
      expect(resolveStageVars({ ...be, config: { PM2_SCRIPT: 'dist/other.js' } }).PM2_SCRIPT).toBe('dist/other.js');
    });
  });
});

describe('M2 部署目标推导（模块自持 deployRoot，环境只分层）', () => {
  const ws = '/ws';
  it('产物区 = <ws>/artifacts/<module>/<env>/<版本>', () => {
    expect(artifactsDir(ws, 'gateway', 'dev', 'gateway-dev/abc1234')).toBe(
      '/ws/artifacts/gateway/dev/gateway-dev/abc1234',
    );
  });
  it('部署目标 = <ws>/<deployRoot>/<默认产物>', () => {
    expect(deployTargetAbs(ws, 'servers/gateway', 'dist/')).toBe('/ws/servers/gateway/dist');
  });
  it('前端类无默认产物 → 部署目标就是根本身（切指针）', () => {
    expect(deployTargetAbs(ws, 'servers/gateway/public/static/modules/admin', null)).toBe(
      '/ws/servers/gateway/public/static/modules/admin',
    );
  });
  it('未配 deployRoot → 返回空串（调用方回退旧的流水线变量，双轨零破坏）', () => {
    expect(deployTargetAbs(ws, undefined, 'dist/')).toBe('');
    expect(deployRootAbs(ws, undefined)).toBe(ws);
  });
  it('注入新变量且不覆盖旧变量（旧模板行为不变）', () => {
    const v = resolveStageVars({
      env: 'dev',
      moduleKey: 'gateway',
      moduleType: 'backend',
      dir: 'gateway',
      deployRoot: 'servers/gateway',
      defaultArtifactPath: 'dist/',
      stage: 'release',
      commitId: 'gateway-dev/abc1234',
      releaseWorkspace: ws,
      pipelineVars: { PUBLISH_PATH: '/legacy/path' },
    });
    expect(v.PUBLISH_PATH).toBe('/legacy/path');
    expect(v.ARTIFACTS_DIR).toBe('/ws/artifacts/gateway/dev/gateway-dev/abc1234');
    expect(v.DEPLOY_TARGET).toBe('/ws/servers/gateway/dist');
  });
});
