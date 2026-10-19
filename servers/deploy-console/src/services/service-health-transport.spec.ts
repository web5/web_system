import { BadRequestException } from '@nestjs/common';
import { ServicesService } from './services.service';

describe('service health transport', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response); });
  afterEach(() => jest.restoreAllMocks());

  function fixture(config: Record<string, string> = { SERVICE_HEALTH_TRANSPORT_DEV: 'ssh' }) {
    const host = { name: 'explicit-dev-node', host: 'dev.example', sshUser: 'operator', runtime: 'pm2', enabled: true };
    const row: any = { envId: 'dev', hostName: host.name, port: 6005, runtime: 'pm2' };
    const service: any = Object.create(ServicesService.prototype);
    const ssh = {
      configForHost: jest.fn(() => ({ host: host.host, port: 22, username: host.sshUser })),
      execOn: jest.fn().mockResolvedValue(JSON.stringify({ ok: true, status: 200 })),
      resolve: jest.fn(), run: jest.fn(),
    };
    Object.assign(service, {
      getService: jest.fn().mockResolvedValue({ key: 'todo-service', healthPath: '/health' }),
      serviceEnvRepo: { findOne: jest.fn().mockResolvedValue(row) },
      hostRepo: { findOne: jest.fn().mockResolvedValue(host) },
      configService: { get: jest.fn((key: string) => config[key]) }, ssh,
    });
    return { service, host, row, ssh };
  }

  it('probes the exact registered host over SSH instead of probing the controller or an env default', async () => {
    const { service, host, ssh } = fixture();
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ ok: true, status: 200, transport: 'ssh', target: 'http://dev.example:6005/health', probeTarget: 'http://127.0.0.1:6005/health', probeHost: host.host });
    expect(ssh.configForHost).toHaveBeenCalledWith(host);
    expect(ssh.execOn).toHaveBeenCalledWith(expect.objectContaining({ host: host.host }), expect.stringContaining('CONSOLE_MANAGED_HEALTH'), 'health:dev/todo-service', 10000);
    expect(ssh.resolve).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['prod', 'local'])('keeps %s direct HTTP behavior when only dev is configured', async env => {
    const { service, ssh } = fixture();
    await expect(service.probeHealth('todo-service', env)).resolves.toMatchObject({ ok: true, transport: 'direct' });
    expect(fetchMock).toHaveBeenCalledWith('http://dev.example:6005/health', expect.objectContaining({ signal: expect.anything() }));
    expect(ssh.execOn).not.toHaveBeenCalled();
  });

  it('honors an explicit upstream URL instead of probing a different loopback endpoint', async () => {
    const { service, row, ssh } = fixture(); row.upstreamUrl = 'https://explicit.example/api';
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ transport: 'direct', target: 'https://explicit.example/api/health' });
    expect(ssh.execOn).not.toHaveBeenCalled();
  });

  it.each(['SSH unavailable', 'Key missing'])('does not fall back to controller localhost on %s', async message => {
    const { service, ssh } = fixture(); ssh.configForHost.mockImplementation(() => { throw new Error(message); });
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ ok: false, status: 0, transport: 'ssh', error: message });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['not-json', '{"ok":true,"status":503}', '{"ok":true}', 'null'])('rejects invalid remote health output %s', async output => {
    const { service, ssh } = fixture(); ssh.execOn.mockResolvedValue(output);
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ ok: false, status: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not report a remote HTTP failure as healthy', async () => {
    const { service, ssh } = fixture(); ssh.execOn.mockResolvedValue('{"ok":false,"status":503}');
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ ok: false, status: 503, transport: 'ssh' });
  });

  it('does not substitute a direct or controller-local probe when SSH execution fails', async () => {
    const { service, ssh } = fixture(); ssh.execOn.mockRejectedValue(new Error('SSH connection refused'));
    await expect(service.probeHealth('todo-service', 'dev')).resolves.toMatchObject({ ok: false, status: 0, transport: 'ssh', error: 'SSH connection refused' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, 65536, 1.5])('rejects an invalid target-machine port %s', async port => {
    const { service, row, ssh } = fixture(); row.port = port;
    await expect(service.probeHealth('todo-service', 'dev')).rejects.toBeInstanceOf(BadRequestException);
    expect(ssh.execOn).not.toHaveBeenCalled();
  });

  it('does not guess a host-loopback endpoint for a container runtime', async () => {
    const { service, row, ssh } = fixture(); row.runtime = 'docker';
    await expect(service.probeHealth('todo-service', 'dev')).rejects.toThrow('已登记的 PM2 主机');
    expect(ssh.execOn).not.toHaveBeenCalled();
  });

  it.each(['//other-host/health', 'https://other-host/health', '/health\ninvalid'])('rejects an unsafe target-machine health path %s', async healthPath => {
    const { service, row, ssh } = fixture(); row.healthPath = healthPath;
    await expect(service.probeHealth('todo-service', 'dev')).rejects.toBeInstanceOf(BadRequestException);
    expect(ssh.execOn).not.toHaveBeenCalled();
  });

  it('fails before network access when the registered host is absent', async () => {
    const { service, ssh } = fixture(); service.hostRepo.findOne.mockResolvedValue(null);
    await expect(service.probeHealth('todo-service', 'dev')).rejects.toThrow('未在「主机管理」登记');
    expect(ssh.execOn).not.toHaveBeenCalled();
  });
});
