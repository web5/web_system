import { ReleaseRegistryService } from './release-registry.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

describe('ReleaseRegistryService（版本表/指针工具）', () => {
  let versionRepo: { create: jest.Mock; save: jest.Mock };
  let deploymentRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let svc: ReleaseRegistryService;

  beforeEach(() => {
    versionRepo = {
      create: jest.fn((d: Partial<DeployVersionEntity>) => ({ ...d })),
      save: jest.fn(async (x: unknown) => x),
    };
    deploymentRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn(() => ({})),
      save: jest.fn(async (x: unknown) => x),
    };
    svc = new ReleaseRegistryService(versionRepo as never, deploymentRepo as never);
  });

  it('registerVersion 按字段写入 deploy_versions（含默认状态/时间）', async () => {
    await svc.registerVersion({
      env: 'dev',
      moduleKey: 'admin',
      versionTag: 'abc1234',
      gitCommit: 'abc1234',
      gitBranch: 'master',
      releasedBy: 'admin',
      taskId: 't-1',
      note: '流水线发布',
    });
    const saved = versionRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      env: 'dev',
      component: 'admin',
      versionTag: 'abc1234',
      gitCommit: 'abc1234',
      gitBranch: 'master',
      releasedBy: 'admin',
      taskId: 't-1',
      note: '流水线发布',
      status: 'active',
    });
    expect(saved.releasedAt).toBeInstanceOf(Date);
  });

  it('setPointer 无记录时新建（upsert）', async () => {
    await svc.setPointer({ env: 'dev', moduleKey: 'admin', currentVersion: 'abc', deployedBy: 'op', taskId: 't-1' });
    expect(deploymentRepo.findOne).toHaveBeenCalledWith({ where: { envId: 'dev', moduleKey: 'admin' } });
    expect(deploymentRepo.create).toHaveBeenCalled();
    const saved = deploymentRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      envId: 'dev',
      moduleKey: 'admin',
      currentVersion: 'abc',
      status: 'deployed',
      deployedBy: 'op',
      taskId: 't-1',
    });
    expect(saved.deployedAt).toBeInstanceOf(Date);
  });

  it('setPointer 已有记录时更新不重建', async () => {
    const existing = { envId: 'dev', moduleKey: 'admin', currentVersion: 'old' };
    deploymentRepo.findOne.mockResolvedValue(existing);
    await svc.setPointer({ env: 'dev', moduleKey: 'admin', currentVersion: 'new', taskId: 't-2' });
    expect(deploymentRepo.create).not.toHaveBeenCalled();
    expect(existing).toMatchObject({ currentVersion: 'new', status: 'deployed', taskId: 't-2' });
  });

  it('currentVersion 返回指针版本', async () => {
    deploymentRepo.findOne.mockResolvedValue({ currentVersion: 'abc' });
    expect(await svc.currentVersion('dev', 'admin')).toBe('abc');
    deploymentRepo.findOne.mockResolvedValue(null);
    expect(await svc.currentVersion('dev', 'admin')).toBeUndefined();
  });
});
