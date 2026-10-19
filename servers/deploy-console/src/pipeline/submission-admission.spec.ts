import { ConflictException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';

describe('pipeline submission admission', () => {
  const dto = { env: 'dev', moduleKey: 'todo-service', branch: 'master', commitId: 'e1618537' };

  function fixture() {
    const service: any = Object.create(PipelineService.prototype);
    Object.assign(service, {
      releaseLock: { acquire: jest.fn().mockResolvedValue(true), release: jest.fn().mockResolvedValue(undefined) },
      configService: { get: jest.fn() }, git: { assertWorkspaceSafe: jest.fn() },
      pipelineRepo: { findOne: jest.fn() }, templates: { resolveForSubmit: jest.fn() },
    });
    return service;
  }

  it.each(['pending', 'running', 'pending-approval', 'awaiting-approval'])('rejects a second submission while the first is %s', async status => {
    const service = fixture();
    service.pipelineRepo.findOne.mockImplementation(async ({ where }: any) =>
      where.some((condition: any) => condition.status === status) ? { id: 'existing-run', status } : null,
    );
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(service.templates.resolveForSubmit).not.toHaveBeenCalled();
    expect(service.releaseLock.release).toHaveBeenCalledTimes(1);
  });

  it('does not check or create a run when another submitter holds the admission lock', async () => {
    const service = fixture();
    service.releaseLock.acquire.mockResolvedValue(false);
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(service.pipelineRepo.findOne).not.toHaveBeenCalled();
    expect(service.releaseLock.release).not.toHaveBeenCalled();
  });

  it('holds admission until the new run is persisted and always releases on failure', async () => {
    const service = fixture();
    let finish!: () => void;
    service.submitWithAdmission = jest.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = service.submit(dto);
    await Promise.resolve();
    expect(service.releaseLock.release).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(service.releaseLock.release).toHaveBeenCalledTimes(1);
    service.submitWithAdmission.mockRejectedValue(new Error('save failed'));
    await expect(service.submit(dto)).rejects.toThrow('save failed');
    expect(service.releaseLock.release).toHaveBeenCalledTimes(2);
  });
});
