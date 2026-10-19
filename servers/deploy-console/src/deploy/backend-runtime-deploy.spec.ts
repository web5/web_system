import { DeployService } from './deploy.service';

describe('isolated backend runtime deployment route', () => {
  function fixture() {
    const service: any = Object.create(DeployService.prototype);
    Object.assign(service, {
      configService: { get: jest.fn((key: string) => key === 'RELEASE_WORKSPACE' ? '/build' : undefined) },
      getWebSystemDir: jest.fn(() => '/runtime'),
      getSshConfig: jest.fn().mockResolvedValue({ host: 'dev-host' }),
      sshTimeoutMs: jest.fn(() => 30000),
      sshRun: jest.fn(async (_target: unknown, command: string) => command.includes("printf 'isolated-runtime-v1'") ? 'isolated-runtime-v1' : '{}'),
      logger: { log: jest.fn(), warn: jest.fn() },
    });
    return service;
  }

  it('recognizes an isolated runtime and delegates activation without runtime git or install', async () => {
    const service = fixture();
    await service.applyBackendRemote({ moduleKey: 'todo-service', env: 'dev', versionTag: 'todo-dev/abcdef12' }, { dir: 'todo-service', pm2: 'web-todo' });
    expect(service.sshRun).toHaveBeenCalledTimes(2);
    const command = service.sshRun.mock.calls[1][1];
    expect(command).toContain("BACKEND_RUNTIME_ACTION='activate'");
    expect(command).toContain('/runtime/servers/todo-service/todo-dev/abcdef12');
    expect(command).not.toContain('git reset');
    expect(command).not.toContain('pnpm install');
    expect(command).not.toContain('pm2 restart all');
    expect(service.sshRun.mock.calls[1][3]).toBeGreaterThanOrEqual(120000);
  });

  it('an isolated activation failure cannot fall back to legacy copying', async () => {
    const service = fixture();
    service.sshRun.mockImplementation(async (_target: unknown, command: string) => {
      if (command.includes("printf 'isolated-runtime-v1'")) return 'isolated-runtime-v1';
      throw new Error('previous dist restored and healthy');
    });
    await expect(service.applyBackendRemote({ moduleKey: 'todo-service', env: 'dev', versionTag: 'todo-dev/abcdef12' }, { dir: 'todo-service' })).rejects.toThrow(/restored/);
    expect(service.sshRun).toHaveBeenCalledTimes(2);
    expect(service.sshRun.mock.calls.some(([, command]: [unknown, string]) => command.includes('cp -R'))).toBe(false);
  });

  it('does not guess a legacy format when the remote format probe fails', async () => {
    const service = fixture();
    service.sshRun.mockRejectedValue(new Error('SSH unavailable'));
    await expect(service.applyBackendRemote({ moduleKey: 'todo-service', env: 'dev', versionTag: 'todo-dev/abcdef12' }, { dir: 'todo-service' })).rejects.toThrow(/拒绝继续落地/);
    expect(service.sshRun).toHaveBeenCalledTimes(1);
  });

  it('refuses legacy copy and restart when the configured root is not the actual process root', async () => {
    const service = fixture();
    service.sshRun.mockImplementation(async (_target: unknown, command: string) => {
      if (command.includes("printf 'isolated-runtime-v1'")) return '';
      throw new Error('登记部署目录与实际运行入口不一致');
    });
    await expect(service.applyBackendRemote({ moduleKey: 'todo-service', env: 'prod', versionTag: 'todo-dev/abcdef12' }, { dir: 'todo-service' })).rejects.toThrow('实际运行入口');
    expect(service.sshRun).toHaveBeenCalledTimes(2);
    expect(service.sshRun.mock.calls.some(([, command]: [unknown, string]) => /cp -R|mv .*dist|pm2 restart/.test(command))).toBe(false);
  });
});
