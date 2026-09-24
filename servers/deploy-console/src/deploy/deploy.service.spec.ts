import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DeployService } from './deploy.service';
import { DeployTaskEntity } from '../entities/deploy-task.entity';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { EnvironmentService } from '../environment/environment.service';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ServerService } from '../server/server.service';
import { HostsService } from '../hosts/hosts.service';
import { StageCommandService } from '../stage-command/stage-command.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CommandService } from '../shell/command.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService as ConfigCenterService } from '../config/config.service';
import { AppsService } from '../apps/apps.service';

/** 配置中心桩：默认「无 module 级条目」→ 既有用例走「跳过下发」路径，行为不变 */
const noDispatchConfigCenter = () => ({
  hasModuleScope: jest.fn().mockResolvedValue(false),
  dispatchPayload: jest.fn().mockResolvedValue([]),
  resolveForProcess: jest.fn().mockResolvedValue({}),
});

/** 审计桩（下发只记「键 + hash」，不记明文） */
const auditStub = () => ({ log: jest.fn().mockResolvedValue(undefined) });

// ssh2 全程 mock：远程部署测试不能真的连机器
jest.mock('ssh2', () => {
  const { EventEmitter } = require('events');
  class FakeClient extends EventEmitter {
    connect = jest.fn((_cfg: any) => setImmediate(() => this.emit('ready')));
    end = jest.fn();
    sftp = jest.fn((cb: any) => cb(null, { fastPut: (_a: string, _b: string, cb2: any) => cb2(null) }));
    exec = jest.fn((cmd: string, cb: any) => {
      const s: any = new EventEmitter();
      s.stderr = new EventEmitter();
      cb(null, s);
      // 每次调用时再取实现（测试里可随时替换）
      const impl = (global as any).__sshExecImpl;
      const r = typeof impl === 'function' ? impl(cmd) : { code: 0, out: 'ok' };
      setImmediate(() => {
        s.emit('data', Buffer.from(String(r.out || '')));
        s.emit('close', r.code);
      });
    });
  }
  return { Client: FakeClient };
});

/**
 * P0-2 单元测试：recordDeployment 改用原子 upsert，不再产生重复。
 * 断言：conflict target 为 ['envId','moduleKey']（对应唯一约束 uk_env_module）。
 */
describe('DeployService.recordDeployment (P0-2 upsert)', () => {
  let service: DeployService;
  let deploymentRepo: { upsert: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    deploymentRepo = {
      upsert: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: deploymentRepo },
        {
          provide: EnvironmentService,
          useValue: { get: jest.fn().mockResolvedValue({ publicUrl: '' }), list: jest.fn().mockResolvedValue([]) },
        },
        { provide: ModuleRegistryService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        {
          provide: StageCommandService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
        // 后台模块部署「落地 + pm2 重启」依赖（本 spec 不触发，仅满足 DI）
        {
          provide: CommandService,
          useValue: { pm2Bin: jest.fn(() => 'pm2'), exec: jest.fn(() => '') },
        },
        { provide: ConfigCenterService, useValue: noDispatchConfigCenter() },
        { provide: AuditService, useValue: auditStub() },
        // env-dir 应用查表（本 spec 模块均非应用 → 返回 null，走 legacy 分支）
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('部署成功时调用 upsert，conflict target 为 [envId, moduleKey]', async () => {
    await (service as any).recordDeployment({
      id: 't1',
      type: 'deploy',
      env: 'dev',
      component: 'admin',
      tag: 'a1f5301',
      status: 'success',
      logs: [],
      startTime: Date.now(),
      operator: 'admin',
    });

    expect(deploymentRepo.upsert).toHaveBeenCalledTimes(1);
    const [entity, conflictPaths] = deploymentRepo.upsert.mock.calls[0];
    expect(conflictPaths).toEqual(['envId', 'moduleKey']);
    expect(entity.envId).toBe('dev');
    expect(entity.moduleKey).toBe('admin');
    expect(entity.currentVersion).toBe('a1f5301');
  });

  it('缺 env 或 component 时跳过（不调用 upsert）', async () => {
    await (service as any).recordDeployment({
      id: 't2',
      type: 'deploy',
      env: '',
      component: 'admin',
      tag: 'x',
      status: 'success',
      logs: [],
      startTime: Date.now(),
    });
    expect(deploymentRepo.upsert).not.toHaveBeenCalled();
  });
});

/**
 * 2026-09-15：后台模块部署必须「落地 + 重启」——
 * 投递脚本把产物放在 servers/<dir>/<流水线key>/<commit>/（版本目录），
 * 而服务跑的是 servers/<dir>/dist/。只改指针不生效。
 */
describe('DeployService.deployVersion（后台模块：落地 dist + pm2 重启）', () => {
  let service: DeployService;
  let workspace: string;
  let commands: { pm2Bin: jest.Mock; exec: jest.Mock };
  let moduleRegistry: { get: jest.Mock };
  /** 真实存在的私钥文件（SSH 配置现在要求私钥必须存在，缺失即显式报错） */
  const sshKeyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-key-')), 'id_ed25519');

  beforeEach(async () => {
    fs.writeFileSync(sshKeyFile, 'PRIVATE-KEY-STUB');
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-be-'));
    // 版本目录（发布流水线的产物）
    fs.mkdirSync(path.join(workspace, 'servers/mcp-gateway/mcp-gateway-local/abc1234'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspace, 'servers/mcp-gateway/mcp-gateway-local/abc1234/main.js'),
      '// new',
    );
    // 旧 dist
    fs.mkdirSync(path.join(workspace, 'servers/mcp-gateway/dist'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'servers/mcp-gateway/dist/main.js'), '// old');

    commands = { pm2Bin: jest.fn(() => '/usr/local/bin/pm2'), exec: jest.fn(() => 'ok') };
    (global as any).__sshCmds = [];
    (global as any).__sshExecImpl = (cmd: string) => {
      ((global as any).__sshCmds as string[]).push(cmd);
      return { code: 0, out: 'ok' };
    };
    moduleRegistry = {
      get: jest.fn().mockResolvedValue({
        key: 'mcp-gateway',
        type: 'backend',
        dir: 'mcp-gateway',
        pm2: 'web-mcp-gateway',
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? workspace : undefined) },
        },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: { upsert: jest.fn(), find: jest.fn().mockResolvedValue([]) } },
        { provide: EnvironmentService, useValue: { get: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        { provide: ModuleRegistryService, useValue: moduleRegistry },
        {
          provide: ServerService,
          useValue: {
            resolveServers: jest.fn().mockResolvedValue([]),
            // 远程部署需要环境默认服务器（私钥必须真实存在：缺失已改为显式报错）
            resolveEnvDefaultServer: jest
              .fn()
              .mockResolvedValue({ host: '127.0.0.1', sshUser: 'ubuntu', sshKeyPath: sshKeyFile }),
          },
        },
        {
          provide: HostsService,
          useValue: {
            // 新模型未登记 → 回退旧表（resolveEnvDefaultServer）
            resolveHostForService: jest.fn().mockResolvedValue(null),
            resolveEnvHosts: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
        { provide: ConfigCenterService, useValue: noDispatchConfigCenter() },
        { provide: AuditService, useValue: auditStub() },
        // env-dir 应用查表（本 spec 模块均非应用 → 返回 null，走 legacy 分支）
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('后台模块：版本目录落到 dist，并重启 pm2', async () => {
    await service.deployVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      versionTag: 'mcp-gateway-local/abc1234',
    });

    const dist = path.join(workspace, 'servers/mcp-gateway/dist/main.js');
    expect(fs.existsSync(dist)).toBe(true);
    expect(fs.readFileSync(dist, 'utf-8')).toBe('// new');
    expect(commands.exec).toHaveBeenCalled();
    expect(String(commands.exec.mock.calls[0][0])).toContain('restart web-mcp-gateway');
  });

  it('后台模块：旧 dist 先备份（dist.bak-*）', async () => {
    await service.deployVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      versionTag: 'mcp-gateway-local/abc1234',
    });
    const baks = fs
      .readdirSync(path.join(workspace, 'servers/mcp-gateway'))
      .filter((f) => f.startsWith('dist.bak-'));
    expect(baks.length).toBe(1);
    expect(fs.readFileSync(path.join(workspace, 'servers/mcp-gateway', baks[0], 'main.js'), 'utf-8')).toBe(
      '// old',
    );
  });

  it('后台模块：版本目录不存在 → 报错（不静默成功）', async () => {
    await expect(
      service.deployVersion({
        moduleKey: 'mcp-gateway',
        env: 'local',
        versionTag: 'mcp-gateway-local/nope',
      }),
    ).rejects.toThrow(/找不到版本目录/);
  });

  it('前端类：只改指针，不落地/不重启', async () => {
    moduleRegistry.get.mockResolvedValue({ key: 'admin', type: 'micro-frontend', dir: 'admin' });
    await service.deployVersion({ moduleKey: 'admin', env: 'local', versionTag: 'admin-local/abc' });
    expect(commands.exec).not.toHaveBeenCalled();
  });

  it('后台 + 非 local 环境：走 SSH 远程落地，本机不动', async () => {
    await service.deployVersion({
      moduleKey: 'mcp-gateway',
      env: 'dev',
      versionTag: 'mcp-gateway-local/abc1234',
    });
    // 本机不重启、本机 dist 不变
    expect(commands.exec).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(workspace, 'servers/mcp-gateway/dist/main.js'), 'utf-8')).toBe(
      '// old',
    );
    // 远端执行过：备份 dist + 解包 + pm2 重启
    const cmds = ((global as any).__sshCmds as string[]) || [];
    expect(cmds.some((c) => c.includes('dist.bak-'))).toBe(true);
    expect(cmds.some((c) => c.includes('pm2 restart'))).toBe(true);
  });

  it('后台 + 远程失败：抛错且指针不改（先落地后改指针）', async () => {
    (global as any).__sshExecImpl = () => ({ code: 1, out: 'boom' });
    const upsert = (service as any).deploymentRepo.upsert as jest.Mock;
    upsert.mockClear();
    await expect(
      service.deployVersion({
        moduleKey: 'mcp-gateway',
        env: 'dev',
        versionTag: 'mcp-gateway-local/abc1234',
      }),
    ).rejects.toThrow(/远程部署失败/);
    expect(upsert).not.toHaveBeenCalled();
    (global as any).__sshExecImpl = undefined;
  });
});

describe('DeployService 后台部署 · pm2 进程名回退', () => {
  let service: DeployService;
  let workspace: string;
  let commands: { pm2Bin: jest.Mock; exec: jest.Mock };

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-pm2-'));
    fs.mkdirSync(path.join(workspace, 'servers/gateway/gateway-local/aaa'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'servers/gateway/gateway-local/aaa/main.js'), '// new');
    commands = {
      pm2Bin: () => '/usr/local/bin/pm2',
      // 注册表里的裸名 `gateway` 不存在 → 失败；`web-gateway` 成功
      exec: jest.fn((cmd: string) => {
        if (String(cmd).includes('restart gateway')) throw new Error('Process or Namespace gateway not found');
        return 'ok';
      }),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? workspace : undefined) },
        },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: { save: jest.fn() } },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: { upsert: jest.fn(), find: jest.fn().mockResolvedValue([]) } },
        { provide: EnvironmentService, useValue: { get: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        {
          provide: ModuleRegistryService,
          useValue: {
            get: jest.fn().mockResolvedValue({ key: 'gateway', type: 'backend', dir: 'gateway', pm2: 'gateway' }),
          },
        },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
        { provide: ConfigCenterService, useValue: noDispatchConfigCenter() },
        { provide: AuditService, useValue: auditStub() },
        // env-dir 应用查表（本 spec 模块均非应用 → 返回 null，走 legacy 分支）
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('注册表进程名不存在时，回退到 web-<key>', async () => {
    await service.deployVersion({
      moduleKey: 'gateway',
      env: 'local',
      versionTag: 'gateway-local/aaa',
    });
    const calls = commands.exec.mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((c) => c.includes('restart gateway'))).toBe(true);
    expect(calls.some((c) => c.includes('restart web-gateway'))).toBe(true);
  });
});

/**
 * T2：回滚动作（后台模块）
 * - 回滚 = 找到「上一版本」→ 走与部署相同的落地 + 重启 → 改指针
 * - 版本目录被清掉时，用最近的 dist.bak-<ts> 兜底恢复
 */
describe('DeployService.rollbackVersion（T2 回滚）', () => {
  let service: DeployService;
  let workspace: string;
  let commands: { pm2Bin: jest.Mock; exec: jest.Mock };
  let deploymentRepo: { upsert: jest.Mock; findOne: jest.Mock; find: jest.Mock };
  let versionRepo: { find: jest.Mock };

  const svc = () => path.join(workspace, 'servers/mcp-gateway');

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-'));
    fs.mkdirSync(path.join(workspace, 'servers/mcp-gateway/dist'), { recursive: true });
    fs.writeFileSync(path.join(svc(), 'dist/main.js'), '// B(new)');
    commands = { pm2Bin: jest.fn(() => '/usr/local/bin/pm2'), exec: jest.fn(() => 'ok') };
    deploymentRepo = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ currentVersion: 'mcp-gateway-local/B' }),
      find: jest.fn().mockResolvedValue([]),
    };
    versionRepo = {
      // B(当前) / A(上一个) / 更早
      find: jest.fn().mockResolvedValue([
        { versionTag: 'mcp-gateway-local/B' },
        { versionTag: 'mcp-gateway-local/A' },
      ]),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? workspace : undefined) },
        },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: versionRepo },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: deploymentRepo },
        { provide: EnvironmentService, useValue: { get: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        {
          provide: ModuleRegistryService,
          useValue: {
            get: jest.fn().mockResolvedValue({
              key: 'mcp-gateway',
              type: 'backend',
              dir: 'mcp-gateway',
              pm2: 'web-mcp-gateway',
            }),
          },
        },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
        { provide: ConfigCenterService, useValue: noDispatchConfigCenter() },
        { provide: AuditService, useValue: auditStub() },
        // env-dir 应用查表（本 spec 模块均非应用 → 返回 null，走 legacy 分支）
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('回滚到上一版本：dist 变回该版本内容 + 指针回退', async () => {
    fs.mkdirSync(path.join(svc(), 'mcp-gateway-local/A'), { recursive: true });
    fs.writeFileSync(path.join(svc(), 'mcp-gateway-local/A/main.js'), '// A(old)');

    const r = await service.rollbackVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      operator: 't2',
    });

    expect(r.from).toBe('mcp-gateway-local/B');
    expect(r.to).toBe('mcp-gateway-local/A');
    expect(fs.readFileSync(path.join(svc(), 'dist/main.js'), 'utf-8')).toBe('// A(old)');
    expect(String(commands.exec.mock.calls[0][0])).toContain('restart web-mcp-gateway');
    expect(deploymentRepo.upsert).toHaveBeenCalled();
  });

  it('版本目录已清理：用最近的 dist.bak-* 兜底恢复', async () => {
    // 造一个备份（内容是 A）
    fs.mkdirSync(path.join(svc(), 'dist.bak-1789000000000'), { recursive: true });
    fs.writeFileSync(path.join(svc(), 'dist.bak-1789000000000/main.js'), '// A(backup)');

    const r = await service.rollbackVersion({ moduleKey: 'mcp-gateway', env: 'local' });

    expect(r.to).toBe('mcp-gateway-local/A');
    expect(fs.readFileSync(path.join(svc(), 'dist/main.js'), 'utf-8')).toBe('// A(backup)');
  });

  it('没有历史版本 → 明确报错', async () => {
    versionRepo.find.mockResolvedValue([{ versionTag: 'mcp-gateway-local/B' }]);
    await expect(service.rollbackVersion({ moduleKey: 'mcp-gateway', env: 'local' })).rejects.toThrow(
      /没有可回滚的历史版本/,
    );
  });

  it('版本目录和备份都没有 → 报错（不静默成功）', async () => {
    fs.rmSync(path.join(svc(), 'dist'), { recursive: true, force: true });
    await expect(service.rollbackVersion({ moduleKey: 'mcp-gateway', env: 'local' })).rejects.toThrow(
      /找不到版本目录|没有 dist 备份/,
    );
  });
});

describe('DeployService.rollbackVersion · 指定目标版本（UI「回滚到此版本」）', () => {
  let service: DeployService;
  let workspace: string;
  let deploymentRepo: { upsert: jest.Mock; findOne: jest.Mock; find: jest.Mock };
  let commands: { pm2Bin: jest.Mock; exec: jest.Mock };
  const svc = () => path.join(workspace, 'servers/mcp-gateway');

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-to-'));
    fs.mkdirSync(path.join(svc(), 'dist'), { recursive: true });
    fs.writeFileSync(path.join(svc(), 'dist/main.js'), '// current');
    ['A', 'B'].forEach((v) => {
      fs.mkdirSync(path.join(svc(), 'mcp-gateway-local/' + v), { recursive: true });
      fs.writeFileSync(path.join(svc(), 'mcp-gateway-local/' + v, '/main.js'), '// ' + v);
    });
    deploymentRepo = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ currentVersion: 'mcp-gateway-local/B' }),
      find: jest.fn().mockResolvedValue([]),
    };
    commands = { pm2Bin: jest.fn(() => '/usr/local/bin/pm2'), exec: jest.fn(() => 'ok') };
    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? workspace : undefined) },
        },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: deploymentRepo },
        { provide: EnvironmentService, useValue: { get: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        {
          provide: ModuleRegistryService,
          useValue: {
            get: jest.fn().mockResolvedValue({ key: 'mcp-gateway', type: 'backend', dir: 'mcp-gateway', pm2: 'web-mcp-gateway' }),
          },
        },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
        { provide: ConfigCenterService, useValue: noDispatchConfigCenter() },
        { provide: AuditService, useValue: auditStub() },
        // env-dir 应用查表（本 spec 模块均非应用 → 返回 null，走 legacy 分支）
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('按行指定版本：回滚到该版本（不是「上一个」）', async () => {
    const r = await service.rollbackVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      to: 'mcp-gateway-local/A',
    });
    expect(r.to).toBe('mcp-gateway-local/A');
    expect(fs.readFileSync(path.join(svc(), 'dist/main.js'), 'utf-8')).toBe('// A');
  });

  it('指定当前版本 → 报错', async () => {
    await expect(
      service.rollbackVersion({ moduleKey: 'mcp-gateway', env: 'local', to: 'mcp-gateway-local/B' }),
    ).rejects.toThrow(/就是当前版本/);
  });
});

/**
 * P0-2 配置下发（`specs/service-config-delivery/design.md` §4 / §10-3）：
 * 部署前把配置中心的解析结果写进 `<svc>/.env.generated`（0600，带来源注释，旧版备份），
 * **下发失败即中止部署**（不落地、不重启、指针不改）。
 */
describe('DeployService.writeGeneratedEnv（配置下发到服务进程）', () => {
  let service: DeployService;
  let workspace: string;
  let configCenter: { hasModuleScope: jest.Mock; dispatchPayload: jest.Mock };
  let audit: { log: jest.Mock };
  let commands: { pm2Bin: jest.Mock; exec: jest.Mock };
  let deploymentRepo: { upsert: jest.Mock; find: jest.Mock };
  let moduleRegistry: { get: jest.Mock };

  const svcDir = () => path.join(workspace, 'servers/mcp-gateway');
  const generated = () => path.join(svcDir(), '.env.generated');

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-'));
    fs.mkdirSync(path.join(svcDir(), 'mcp-gateway-local/abc1234'), { recursive: true });
    fs.writeFileSync(path.join(svcDir(), 'mcp-gateway-local/abc1234/main.js'), '// new');
    fs.mkdirSync(path.join(svcDir(), 'dist'), { recursive: true });
    fs.writeFileSync(path.join(svcDir(), 'dist/main.js'), '// old');

    configCenter = {
      hasModuleScope: jest.fn().mockResolvedValue(true),
      dispatchPayload: jest.fn().mockResolvedValue([
        { key: 'GATEWAY_SERVICE_KEY', value: 'svc-key-123', scope: 'module:local/mcp-gateway' },
        { key: 'PORT', value: '6010', scope: 'env:local' },
      ]),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    commands = { pm2Bin: jest.fn(() => '/usr/local/bin/pm2'), exec: jest.fn(() => 'ok') };
    deploymentRepo = { upsert: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    moduleRegistry = {
      get: jest.fn().mockResolvedValue({
        key: 'mcp-gateway',
        type: 'backend',
        dir: 'mcp-gateway',
        pm2: 'web-mcp-gateway',
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        DeployService,
        {
          provide: ConfigService,
          useValue: { get: (k: string) => (k === 'RELEASE_WORKSPACE' ? workspace : undefined) },
        },
        { provide: getRepositoryToken(DeployTaskEntity), useValue: { save: jest.fn(), update: jest.fn() } },
        { provide: getRepositoryToken(DeployVersionEntity), useValue: { save: jest.fn(), find: jest.fn() } },
        { provide: getRepositoryToken(DeployDeploymentEntity), useValue: deploymentRepo },
        { provide: EnvironmentService, useValue: { get: jest.fn(), list: jest.fn().mockResolvedValue([]) } },
        { provide: ModuleRegistryService, useValue: moduleRegistry },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
        { provide: ConfigCenterService, useValue: configCenter },
        { provide: AuditService, useValue: audit },
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('部署前写下发文件：0600、带来源注释、旧版备份、审计不含明文', async () => {
    fs.writeFileSync(generated(), '# old\nOLD_KEY=1\n');

    await service.deployVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      versionTag: 'mcp-gateway-local/abc1234',
    });

    const text = fs.readFileSync(generated(), 'utf-8');
    expect(text).toContain('GATEWAY_SERVICE_KEY=svc-key-123');
    expect(text).toContain('PORT=6010');
    expect(text).toContain('# [module:local/mcp-gateway]');
    expect(text).toContain('# [env:local]');
    expect(text).toContain('删除本文件 + 重启服务');
    expect(fs.statSync(generated()).mode & 0o777).toBe(0o600);

    const baks = fs.readdirSync(svcDir()).filter((f) => f.startsWith('.env.generated.bak-'));
    expect(baks.length).toBe(1);
    expect(fs.readFileSync(path.join(svcDir(), baks[0]), 'utf-8')).toBe('# old\nOLD_KEY=1\n');

    // 审计只记「下发了哪些键 + 内容 hash」，绝不记明文
    expect(audit.log).toHaveBeenCalledTimes(1);
    const detail = String(audit.log.mock.calls[0][0].detail);
    expect(detail).toContain('GATEWAY_SERVICE_KEY');
    expect(detail).not.toContain('svc-key-123');

    // 下发之后才重启
    expect(commands.exec).toHaveBeenCalled();
  });

  it('下发失败 → 中止部署：不重启、不落地、指针不改', async () => {
    configCenter.dispatchPayload.mockRejectedValue(new Error('db down'));

    await expect(
      service.deployVersion({
        moduleKey: 'mcp-gateway',
        env: 'local',
        versionTag: 'mcp-gateway-local/abc1234',
      }),
    ).rejects.toThrow(/db down/);

    expect(commands.exec).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(svcDir(), 'dist/main.js'), 'utf-8')).toBe('// old');
    expect(deploymentRepo.upsert).not.toHaveBeenCalled();
  });

  it('无 module 级条目 → 按需跳过（不落盘），照常落地 + 重启', async () => {
    configCenter.hasModuleScope.mockResolvedValue(false);

    await service.deployVersion({
      moduleKey: 'mcp-gateway',
      env: 'local',
      versionTag: 'mcp-gateway-local/abc1234',
    });

    expect(fs.existsSync(generated())).toBe(false);
    expect(fs.readFileSync(path.join(svcDir(), 'dist/main.js'), 'utf-8')).toBe('// new');
    expect(commands.exec).toHaveBeenCalled();
  });

  it('非后端服务（前端/微前端）不下发', async () => {
    moduleRegistry.get.mockResolvedValue({ key: 'admin', type: 'micro-frontend', dir: 'admin' });
    await expect(service.writeGeneratedEnv('local', 'admin')).resolves.toBeNull();
    expect(configCenter.dispatchPayload).not.toHaveBeenCalled();
  });
});
