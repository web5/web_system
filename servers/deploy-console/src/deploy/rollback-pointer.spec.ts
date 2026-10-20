import { DeployService } from './deploy.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';

const currentVersion = 'todo-service-dev/6a710686';
const checkpoint = 'runtime-checkpoint/todo-prod-1792396360725';

function fixture() {
  const deployments = {
    findOne: jest.fn(async () => ({ envId: 'prod', moduleKey: 'todo-service', currentVersion })),
    create: jest.fn(() => ({})),
    save: jest.fn(async row => row),
    upsert: jest.fn().mockResolvedValue(undefined),
  };
  const writer = {
    mirrorLegacyPointer: jest.fn().mockResolvedValue({ outcome: 'ok' }),
    mirrorPointer: jest.fn(),
  };
  const locks = {
    acquireEx: jest.fn().mockResolvedValue({ ok: true, newly: true }),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const registry = new ReleaseRegistryService(
    {} as never,
    deployments as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    { findOne: jest.fn().mockResolvedValue(null) } as never,
    writer as never,
    locks as never,
  );
  const pointer = jest.spyOn(registry, 'setPointer');
  const activate = jest.fn().mockResolvedValue(undefined);
  const service = Object.create(DeployService.prototype) as DeployService;
  Object.assign(service, { deploymentRepo: deployments, registry, applyBackendVersion: activate, logger: { log: jest.fn() } });
  return { service, deployments, writer, locks, pointer, activate };
}

describe('backend rollback pointer registry', () => {
  it('routes the healthy production rollback through the registry and cloud mirror under the existing lock', async () => {
    const context = fixture();
    const result = await context.service.rollbackVersion({ moduleKey: 'todo-service', env: 'prod', to: checkpoint, operator: 'reviewer', taskId: 'rollback-fixture' });
    const input = { env: 'prod', moduleKey: 'todo-service', currentVersion: checkpoint, deployedBy: 'reviewer', taskId: 'rollback-fixture' };
    expect(context.pointer).toHaveBeenCalledWith(input);
    expect(context.writer.mirrorLegacyPointer).toHaveBeenCalledWith(input);
    expect(context.deployments.save).toHaveBeenCalledWith(expect.objectContaining({ envId: 'prod', moduleKey: 'todo-service', currentVersion: checkpoint, taskId: 'rollback-fixture' }));
    expect(context.deployments.upsert).not.toHaveBeenCalled();
    expect(context.activate.mock.invocationCallOrder[0]).toBeLessThan(context.pointer.mock.invocationCallOrder[0]);
    expect(context.locks.acquireEx).toHaveBeenCalledTimes(1);
    expect(context.locks.release).toHaveBeenCalledWith('todo-service', 'prod', expect.stringMatching(/^rollback:/));
    expect(result).toEqual({ moduleKey: 'todo-service', env: 'prod', from: currentVersion, to: checkpoint });
  });

  it('does not advance or mirror pointers when runtime activation fails', async () => {
    const context = fixture();
    context.activate.mockRejectedValue(new Error('runtime health failed'));
    await expect(context.service.rollbackVersion({ moduleKey: 'todo-service', env: 'prod', to: checkpoint })).rejects.toThrow('runtime health failed');
    expect(context.pointer).not.toHaveBeenCalled();
    expect(context.writer.mirrorLegacyPointer).not.toHaveBeenCalled();
    expect(context.deployments.upsert).not.toHaveBeenCalled();
    expect(context.locks.release).toHaveBeenCalledTimes(1);
  });

  it('propagates registry failures rather than bypassing the mirror and reporting completion', async () => {
    const context = fixture();
    context.writer.mirrorLegacyPointer.mockRejectedValue(new Error('registry mirror failed'));
    await expect(context.service.rollbackVersion({ moduleKey: 'todo-service', env: 'prod', to: checkpoint })).rejects.toThrow('registry mirror failed');
    expect(context.deployments.upsert).not.toHaveBeenCalled();
    expect(context.locks.release).toHaveBeenCalledTimes(1);
  });

  it('does not mirror after the registry local write fails', async () => {
    const context = fixture();
    context.deployments.save.mockRejectedValue(new Error('local registry write failed'));
    await expect(context.service.rollbackVersion({ moduleKey: 'todo-service', env: 'prod', to: checkpoint })).rejects.toThrow('local registry write failed');
    expect(context.writer.mirrorLegacyPointer).not.toHaveBeenCalled();
    expect(context.deployments.upsert).not.toHaveBeenCalled();
    expect(context.locks.release).toHaveBeenCalledTimes(1);
  });
});
