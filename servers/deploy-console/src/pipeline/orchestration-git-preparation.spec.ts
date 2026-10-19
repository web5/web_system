import { PipelineService } from './pipeline.service';
import type { EngineStep } from '../pipeline-orchestration/orchestration-engine';

function scriptStep(name: string, taskName = name): EngineStep {
  return {
    id: `step-${name}`,
    name,
    tasks: [{
      id: `task-${name}`,
      kind: 'script',
      name: taskName,
      actions: [{ id: `action-${name}`, name, script: name }],
    }],
  };
}

function makeService(tree: EngineStep[] = [scriptStep('git'), scriptStep('build')]) {
  const events: string[] = [];
  const service: any = Object.create(PipelineService.prototype);
  const pipeline: any = {
    id: 'dev-acceptance-run',
    env: 'dev',
    moduleKey: 'admin',
    moduleType: 'micro-frontend',
    gitBranch: 'master',
    versionTag: 'admin-dev/c38423cc',
    logs: [],
    orchestration: tree,
  };
  const afterRun = jest.fn(async () => { events.push('prepare'); });
  Object.assign(service, {
    configService: { get: jest.fn((key: string) => key === 'RELEASE_WORKSPACE' ? '/tmp/build-workspace' : undefined) },
    moduleRegistry: { get: jest.fn().mockResolvedValue({ type: 'micro-frontend', dir: 'admin' }) },
    pipelineVars: { resolve: jest.fn().mockResolvedValue({}) },
    registry: { setPointer: jest.fn().mockResolvedValue(undefined) },
    builtinSteps: { pull: { afterRun } },
    cancelled: new Set<string>(),
    resolveInjectEnv: jest.fn().mockResolvedValue({}),
    resolvePortVars: jest.fn().mockResolvedValue({ port: '', source: 'unresolved' }),
    resolveProtectedVersions: jest.fn().mockResolvedValue([]),
    consoleApiBase: jest.fn().mockReturnValue('http://127.0.0.1:6200/api'),
    issueScriptToken: jest.fn().mockReturnValue('test-run-token'),
    resolveGitIdentity: jest.fn(async () => { events.push('identity'); }),
    runShell: jest.fn(async (command: string) => { events.push(command); return 0; }),
    save: jest.fn().mockResolvedValue(undefined),
  });
  return { service, pipeline, events, afterRun };
}

describe('orchestration git preparation', () => {
  it('does not finalize a run cancelled during its final action', async () => {
    const { service, pipeline } = makeService([scriptStep('build')]);
    service.runShell.mockImplementation(async () => {
      service.cancelled.add(pipeline.id);
      return 0;
    });
    await service.runOrchestrationMode(pipeline, null, 'remote');
    expect(pipeline.status).toBe('cancelled');
    expect(pipeline.progress.message).toBe('发布已取消');
    expect(service.registry.setPointer).not.toHaveBeenCalled();
  });

  it('awaits dependency preparation after commit verification and before the build task', async () => {
    const { service, pipeline, events, afterRun } = makeService();
    let releasePreparation!: () => void;
    const prepared = new Promise<void>(resolve => { releasePreparation = resolve; });
    let preparationStarted!: () => void;
    const started = new Promise<void>(resolve => { preparationStarted = resolve; });
    afterRun.mockImplementation(async () => {
      events.push('prepare');
      preparationStarted();
      await prepared;
    });

    const running = service.runOrchestrationMode(pipeline, null, 'remote');
    await Promise.race([started, running]);
    expect(events).toEqual(['git', 'identity', 'prepare']);
    releasePreparation();
    await running;

    expect(events).toEqual(['git', 'identity', 'prepare', 'build']);
    expect(afterRun).toHaveBeenCalledTimes(1);
    expect(afterRun).toHaveBeenCalledWith(expect.objectContaining({ pipeline, uploadTarget: 'remote' }));
    expect(pipeline.status).toBe('succeeded');
  });

  it('does not build or activate when preparation fails', async () => {
    const { service, pipeline, events, afterRun } = makeService();
    afterRun.mockRejectedValue(new Error('workspace dependency preparation failed'));

    await service.runOrchestrationMode(pipeline, null, 'local');

    expect(events).toEqual(['git', 'identity']);
    expect(pipeline.status).toBe('failed');
    expect(pipeline.error).toContain('workspace dependency preparation failed');
    expect(service.registry.setPointer).not.toHaveBeenCalled();
  });

  it('does not prepare dependencies after a failed git action', async () => {
    const { service, pipeline, afterRun } = makeService();
    service.runShell.mockResolvedValue(1);

    await service.runOrchestrationMode(pipeline, null, 'local');

    expect(afterRun).not.toHaveBeenCalled();
    expect(service.resolveGitIdentity).not.toHaveBeenCalled();
    expect(pipeline.status).toBe('failed');
  });

  it('does not prepare dependencies if the requested commit does not match', async () => {
    const { service, pipeline, events, afterRun } = makeService();
    service.resolveGitIdentity.mockRejectedValue(new Error('requested commit mismatch'));

    await service.runOrchestrationMode(pipeline, null, 'local');

    expect(events).toEqual(['git']);
    expect(afterRun).not.toHaveBeenCalled();
    expect(pipeline.status).toBe('failed');
    expect(service.registry.setPointer).not.toHaveBeenCalled();
  });

  it('does not repeat git preparation when resuming after approval', async () => {
    const { service, pipeline, events, afterRun } = makeService([
      scriptStep('git'), scriptStep('build'), { id: 'approval', name: '发布确认' }, scriptStep('publish'),
    ]);

    await service.runOrchestrationMode(pipeline, '发布确认', 'local');

    expect(events).toEqual(['publish']);
    expect(afterRun).not.toHaveBeenCalled();
    expect(service.resolveGitIdentity).not.toHaveBeenCalled();
  });

  it('does not prepare dependencies for unrelated script tasks', async () => {
    const { service, pipeline, events, afterRun } = makeService([scriptStep('build')]);

    await service.runOrchestrationMode(pipeline, null, 'local');

    expect(events).toEqual(['build']);
    expect(afterRun).not.toHaveBeenCalled();
  });

  it('reports the active orchestration step instead of retaining the git stage', async () => {
    const { service, pipeline } = makeService([scriptStep('拉取代码', 'git'), scriptStep('构建', 'build')]);
    const observed: string[][] = [];
    pipeline.stage = 'git';
    service.runShell.mockImplementation(async (command: string) => {
      observed.push([command, pipeline.stage]);
      return 0;
    });

    await service.runOrchestrationMode(pipeline, null, 'local');

    expect(observed).toEqual([['拉取代码', '拉取代码'], ['构建', '构建']]);
  });

  it('preserves backend domain semantics instead of applying frontend finalization', async () => {
    const { service, pipeline } = makeService([scriptStep('build')]);
    pipeline.moduleKey = 'todo-service';
    delete pipeline.moduleType;
    service.moduleRegistry.get.mockResolvedValue({ type: 'backend', dir: 'todo-service' });

    await service.runOrchestrationMode(pipeline, null, 'remote');

    expect(pipeline.status).toBe('succeeded');
    expect(pipeline.moduleType).toBe('backend');
    expect(service.registry.setPointer).not.toHaveBeenCalled();
  });

  it('keeps display stages within the existing database limit without splitting Unicode', async () => {
    const { service, pipeline } = makeService([scriptStep('🚀'.repeat(40), 'build')]);
    await service.runOrchestrationMode(pipeline, null, 'local');
    expect(pipeline.stage).toBe('🚀'.repeat(32));
    expect(pipeline.status).toBe('succeeded');
  });
});
