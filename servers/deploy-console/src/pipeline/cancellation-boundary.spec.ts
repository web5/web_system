import { ConflictException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

function fixture(active = false) {
  const pipeline: any = {
    id: 'cancel-boundary', moduleKey: 'admin', env: 'dev', status: 'running',
    orchestration: [{ id: 'compile', tasks: [{ id: 'build', name: 'build' }] }],
    taskStates: {},
  };
  const service: any = Object.create(PipelineService.prototype);
  Object.assign(service, {
    get: jest.fn().mockResolvedValue(pipeline),
    cancelled: new Set(), running: new Map(active ? [[pipeline.id, Promise.resolve()]] : []),
    shells: new Map([[pipeline.id, {}]]), killShell: jest.fn(),
    pipelineRepo: { save: jest.fn().mockResolvedValue(pipeline) },
    releaseLock: { release: jest.fn().mockResolvedValue(undefined) },
    auditService: { log: jest.fn().mockResolvedValue(undefined) },
  });
  return { service, pipeline };
}

describe('pipeline cancellation boundary', () => {
  it('rejects interruption after build completion without changing execution or locks', async () => {
    const { service, pipeline } = fixture(true);
    pipeline.taskStates['compile/build'] = 'succeeded';
    await expect(service.cancel(pipeline.id)).rejects.toBeInstanceOf(ConflictException);
    expect(service.killShell).not.toHaveBeenCalled();
    expect(service.pipelineRepo.save).not.toHaveBeenCalled();
    expect(service.releaseLock.release).not.toHaveBeenCalled();
    expect(service.cancelled.size).toBe(0);
  });

  it('retains cancellation and lock until the tracked executor has stopped', async () => {
    const { service, pipeline } = fixture(true);
    await expect(service.cancel(pipeline.id)).resolves.toMatchObject({ status: 'cancelled' });
    expect(service.killShell).toHaveBeenCalledTimes(1);
    expect(service.cancelled.has(pipeline.id)).toBe(true);
    expect(service.releaseLock.release).not.toHaveBeenCalled();
  });

  it('releases the lock and cancellation marker when no executor is active', async () => {
    const { service, pipeline } = fixture();
    await service.cancel(pipeline.id);
    expect(service.releaseLock.release).toHaveBeenCalledWith('admin', 'dev', pipeline.id);
    expect(service.cancelled.has(pipeline.id)).toBe(false);
    await service.cancel(pipeline.id);
    expect(service.killShell).toHaveBeenCalledTimes(1);
  });
});
