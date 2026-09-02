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
        { provide: EnvironmentService, useValue: { get: jest.fn() } },
        { provide: ModuleRegistryService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: ServerService, useValue: { resolveServers: jest.fn().mockResolvedValue([]) } },
        {
          provide: StageCommandService,
          useValue: { resolve: jest.fn().mockResolvedValue(null) },
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
