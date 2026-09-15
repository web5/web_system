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
import { StageCommandService } from '../stage-command/stage-command.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CommandService } from '../shell/command.service';

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
        {
          provide: StageCommandService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
        },
        // 后台模块部署「落地 + pm2 重启」依赖（本 spec 不触发，仅满足 DI）
        {
          provide: CommandService,
          useValue: { pm2Bin: jest.fn(() => 'pm2'), exec: jest.fn(() => '') },
        },
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

  beforeEach(async () => {
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
            // 远程部署需要环境默认服务器
            resolveEnvDefaultServer: jest
              .fn()
              .mockResolvedValue({ host: '127.0.0.1', sshUser: 'ubuntu', sshKeyPath: '/no/key' }),
          },
        },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
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
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        { provide: CommandService, useValue: commands },
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
