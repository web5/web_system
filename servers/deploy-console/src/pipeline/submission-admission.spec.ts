import { ConflictException } from '@nestjs/common';
import { PipelineService } from './pipeline.service';
import { FindOperator } from 'typeorm';

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

  function withRuns(rows: Array<{ id: string; status: string; startTime?: number | string | null }>, cutover: string | undefined = '1000') {
    const service = fixture();
    service.configService.get.mockImplementation((key: string) => key === 'RELEASE_WORKSPACE_CUTOVER_MS' ? cutover : undefined);
    service.pipelineRepo.findOne.mockImplementation(async ({ where }: any) => rows.find(row => where.some((condition: any) => {
      if (condition.status !== row.status) return false;
      const expected = condition.startTime;
      if (!(expected instanceof FindOperator)) return expected === undefined || row.startTime === expected;
      if (expected.type === 'isNull') return row.startTime == null;
      if (row.startTime == null) return false;
      if (expected.type === 'moreThanOrEqual') return Number(row.startTime) >= Number(expected.value);
      if (expected.type === 'lessThanOrEqual') return Number(row.startTime) <= Number(expected.value);
      throw new Error('Unexpected admission predicate');
    })) || null);
    const continued = new Error('reached new template resolution');
    service.templates.resolveForSubmit.mockRejectedValue(continued);
    return { service, continued };
  }

  it.each(['pending-approval', 'awaiting-approval'])('does not let a provably unresumable historical %s reserve the submission slot', async status => {
    const rows = [{ id: 'historical-prod', status, startTime: '999' }];
    const before = JSON.stringify(rows);
    const { service, continued } = withRuns(rows);
    await expect(service.submit(dto)).rejects.toBe(continued);
    expect(service.templates.resolveForSubmit).toHaveBeenCalledTimes(1);
    expect(service.pipelineRepo.findOne.mock.calls[0][0].where.every((condition: any) => condition.env === dto.env && condition.moduleKey === dto.moduleKey)).toBe(true);
    expect(JSON.stringify(rows)).toBe(before);
    expect(service.releaseLock.release).toHaveBeenCalledTimes(1);
  });

  it.each(['pending', 'running'])('still blocks an old %s run even before the workspace cutover', async status => {
    const { service } = withRuns([{ id: 'live-work', status, startTime: 999 }]);
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(service.templates.resolveForSubmit).not.toHaveBeenCalled();
  });

  it.each(['pending-approval', 'awaiting-approval'])('still blocks a current %s at the cutover boundary', async status => {
    const { service } = withRuns([{ id: 'current-approval', status, startTime: 1000 }]);
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(service.templates.resolveForSubmit).not.toHaveBeenCalled();
  });

  it.each([undefined, null, 0, -1])('does not exempt an approval with an untrusted start time: %s', async startTime => {
    const { service } = withRuns([{ id: 'unknown-time', status: 'awaiting-approval', startTime }]);
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('finds the current conflict even if an older blocked approval is returned first by storage', async () => {
    const { service } = withRuns([{ id: 'historical', status: 'awaiting-approval', startTime: 999 }, { id: 'current-conflict', status: 'pending-approval', startTime: 1001 }]);
    await expect(service.submit(dto)).rejects.toThrow('current-conflict');
    expect(service.templates.resolveForSubmit).not.toHaveBeenCalled();
  });

  it('retains the original admission behavior when no cutover policy is configured', async () => {
    const { service } = withRuns([{ id: 'retained-approval', status: 'awaiting-approval', startTime: 999 }], '');
    await expect(service.submit(dto)).rejects.toBeInstanceOf(ConflictException);
  });

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
