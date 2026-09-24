/**
 * 产物守卫（P0，2026-09-15）：**版本目录存在 ≠ 有内容**。
 *
 * 背景（真实事故）：后台模块版本目录里只有 `tsconfig.tsbuildinfo`
 * （tsc incremental 判定"已是最新"→ 没产出 JS），旧逻辑照样把它落到 `dist`，
 * 服务重启后入口文件缺失 → 直接变砖。守卫要求：**宁可不落地，也不落坏产物**。
 *
 * 排查与设计见 specs/deploy-console/gateway-and-shell-versioned-release.md §6。
 */
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
import { CommandService } from '../shell/command.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService as ConfigCenterService } from '../config/config.service';
import { AppsService } from '../apps/apps.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DeployService 产物守卫', () => {
  let service: DeployService;
  let workspace: string;
  let deploymentRepo: { upsert: jest.Mock; findOne: jest.Mock; find: jest.Mock };

  const svcDir = () => path.join(workspace, 'servers/mcp-gateway');
  const distDir = () => path.join(svcDir(), 'dist');
  const distMain = () => fs.readFileSync(path.join(distDir(), 'main.js'), 'utf-8');

  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    fs.mkdirSync(distDir(), { recursive: true });
    fs.writeFileSync(path.join(distDir(), 'main.js'), '// current\n');

    deploymentRepo = {
      upsert: jest.fn(),
      findOne: jest.fn().mockResolvedValue({ currentVersion: 'guard/cur' }),
      find: jest.fn().mockResolvedValue([]),
    };

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
            get: jest
              .fn()
              .mockResolvedValue({ key: 'mcp-gateway', type: 'backend', dir: 'mcp-gateway', pm2: 'web-mcp-gateway' }),
          },
        },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        { provide: HostsService, useValue: { resolveHostForService: jest.fn().mockResolvedValue(null), resolveEnvHosts: jest.fn().mockResolvedValue([]) } },
        { provide: StageCommandService, useValue: { resolve: jest.fn().mockResolvedValue(null) } },
        {
          provide: CommandService,
          useValue: { pm2Bin: jest.fn(() => '/usr/local/bin/pm2'), exec: jest.fn(() => 'ok') },
        },
        // 配置下发（P0-2）：本 spec 只关心产物守卫，「无 module 级条目」→ 跳过下发
        {
          provide: ConfigCenterService,
          useValue: { hasModuleScope: jest.fn().mockResolvedValue(false), dispatchPayload: jest.fn() },
        },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: AppsService, useValue: { findAppOrNull: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();
    service = module.get(DeployService);
  });

  it('版本目录为空 → 报错，且不污染现有 dist、不改指针', async () => {
    const empty = path.join(svcDir(), 'guard/empty');
    fs.mkdirSync(empty, { recursive: true });
    await expect(
      service.deployVersion({ moduleKey: 'mcp-gateway', env: 'local', versionTag: 'guard/empty' }),
    ).rejects.toThrow(/版本目录是空的/);
    expect(distMain()).toBe('// current\n');
    expect(deploymentRepo.upsert).not.toHaveBeenCalled();
  });

  it('版本目录只有 tsbuildinfo（tsc 增量未产出）→ 报错，且不动现有 dist', async () => {
    const dir = path.join(svcDir(), 'guard/tsb');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');
    await expect(
      service.deployVersion({ moduleKey: 'mcp-gateway', env: 'local', versionTag: 'guard/tsb' }),
    ).rejects.toThrow(/没有真正的构建产物/);
    expect(distMain()).toBe('// current\n');
  });

  it('版本目录有真产物 → 正常落地（tsbuildinfo 同时存在也算通过）', async () => {
    const dir = path.join(svcDir(), 'guard/ok');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.js'), '// new\n');
    fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');
    await service.deployVersion({ moduleKey: 'mcp-gateway', env: 'local', versionTag: 'guard/ok' });
    expect(distMain()).toBe('// new\n');
  });

  it('回滚同样受守卫保护（空版本目录不会把 dist 冲掉）', async () => {
    const empty = path.join(svcDir(), 'guard/rollback-empty');
    fs.mkdirSync(empty, { recursive: true });
    await expect(
      service.rollbackVersion({ moduleKey: 'mcp-gateway', env: 'local', to: 'guard/rollback-empty' }),
    ).rejects.toThrow(/版本目录是空的/);
    expect(distMain()).toBe('// current\n');
  });
});
