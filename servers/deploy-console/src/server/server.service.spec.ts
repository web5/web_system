import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServerService } from './server.service';
import { DeployServerEntity } from '../entities/deploy-server.entity';
import { DeployEnvServiceRouteEntity } from '../entities/deploy-env-service-route.entity';

/**
 * P1 单元测试：服务器组 + 环境服务路由的解析与 CRUD 逻辑。
 */
describe('ServerService (P1 serverName + route)', () => {
  let service: ServerService;
  let serverRepo: any;
  let routeRepo: any;

  beforeEach(async () => {
    serverRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), remove: jest.fn(), create: jest.fn() };
    routeRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), remove: jest.fn(), create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ServerService,
        { provide: getRepositoryToken(DeployServerEntity), useValue: serverRepo },
        { provide: getRepositoryToken(DeployEnvServiceRouteEntity), useValue: routeRepo },
      ],
    }).compile();
    service = module.get(ServerService);
  });

  it('resolveServers: 有路由时返回该 serverName 组的全部服务器', async () => {
    routeRepo.findOne.mockResolvedValue({ envId: 'dev', serviceName: 'gateway', serverName: 'dev-web' });
    serverRepo.find.mockResolvedValue([
      { id: 's1', serverName: 'dev-web', host: '1.1.1.1' },
      { id: 's2', serverName: 'dev-web', host: '2.2.2.2' },
    ]);

    const servers = await service.resolveServers('dev', 'gateway');

    expect(servers).toHaveLength(2);
    expect(serverRepo.find).toHaveBeenCalledWith({ where: { serverName: 'dev-web' }, order: { host: 'ASC' } });
  });

  it('resolveServers: 无路由时返回空数组（调用方回退默认）', async () => {
    routeRepo.findOne.mockResolvedValue(null);

    const servers = await service.resolveServers('dev', 'gateway');

    expect(servers).toEqual([]);
  });

  it('createRoute: 已存在时更新 serverName 指向', async () => {
    const existing = { envId: 'dev', serviceName: 'gateway', serverName: 'old-default' };
    routeRepo.findOne.mockResolvedValue(existing);
    routeRepo.save.mockResolvedValue(existing);

    await service.createRoute({ envId: 'dev', serviceName: 'gateway', serverName: 'new-group' });

    expect(existing.serverName).toBe('new-group');
    expect(routeRepo.save).toHaveBeenCalledWith(existing);
  });

  it('createServer: 同 serverName 同 host 已存在时报错', async () => {
    serverRepo.findOne.mockResolvedValue({ id: 's1', serverName: 'dev-web', host: '1.1.1.1' });

    await expect(
      service.createServer({ serverName: 'dev-web', host: '1.1.1.1', sshUser: 'root', remoteDir: '/data' }),
    ).rejects.toThrow('服务器已存在');
  });
});
