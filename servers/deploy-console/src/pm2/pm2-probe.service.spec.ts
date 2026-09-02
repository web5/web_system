import { Pm2ProbeService, Pm2App } from './pm2-probe.service';
import { HttpProbeService } from '../probe/http-probe.service';

describe('Pm2ProbeService', () => {
  const httpProbe = new HttpProbeService();
  // listProcesses 在各用例中通过 spyOn 覆盖，构造期传入空 command 即可
  const command = { exec: jest.fn(() => '[]'), pm2Bin: jest.fn(() => 'pm2') } as never;
  let svc: Pm2ProbeService;

  beforeEach(() => {
    svc = new Pm2ProbeService(httpProbe, command);
    jest.restoreAllMocks();
  });

  describe('resolvePm2Names（服务名候选）', () => {
    it('后端 -service 模块：注册表 pm2 优先 + web- 前缀候选', () => {
      expect(svc.resolvePm2Names('todo-service', 'web-todo')).toEqual([
        'web-todo',
        'web-todo-service',
        'todo-service',
        'todo',
      ]);
    });

    it('无注册表 pm2 时生成默认候选（去重）', () => {
      expect(svc.resolvePm2Names('todo-service')).toEqual([
        'web-todo-service',
        'web-todo',
        'todo-service',
        'todo',
      ]);
    });

    it('非 -service 模块不加去后缀候选', () => {
      expect(svc.resolvePm2Names('admin', 'web-admin')).toEqual(['web-admin', 'admin']);
      expect(svc.resolvePm2Names('admin', 'web-admin')).toHaveLength(2);
    });
  });

  describe('probeOnce（单次健康探活）', () => {
    it('候选命中 online 且端口可达 → online + reachable=true', async () => {
      const apps: Pm2App[] = [{ name: 'web-todo', pm2_env: { status: 'online', PORT: 6005 } }];
      jest.spyOn(svc, 'listProcesses').mockReturnValue(apps);
      jest.spyOn(httpProbe, 'request').mockResolvedValue({ ok: true, status: 200, json: undefined });

      const r = await svc.probeOnce('todo-service', 'web-todo');
      expect(r.online).toBe(true);
      expect(r.hit).toMatchObject({ name: 'web-todo', port: 6005 });
      expect(r.reachable).toBe(true);
      expect(httpProbe.request).toHaveBeenCalledWith('http://127.0.0.1:6005/', 'GET', 3000);
    });

    it('online 但端口无响应 → reachable=false', async () => {
      const apps: Pm2App[] = [{ name: 'web-todo', pm2_env: { status: 'online', PORT: 6005 } }];
      jest.spyOn(svc, 'listProcesses').mockReturnValue(apps);
      jest.spyOn(httpProbe, 'request').mockResolvedValue({ ok: false, status: 0, json: undefined });

      const r = await svc.probeOnce('todo-service', 'web-todo');
      expect(r.online).toBe(true);
      expect(r.reachable).toBe(false);
    });

    it('online 但 pm2_env.PORT 缺失 → online=true、reachable 为空（由调用方降级）', async () => {
      const apps: Pm2App[] = [{ name: 'web-todo', pm2_env: { status: 'online' } }];
      jest.spyOn(svc, 'listProcesses').mockReturnValue(apps);

      const r = await svc.probeOnce('todo-service', 'web-todo');
      expect(r.online).toBe(true);
      expect(r.hit?.port).toBeUndefined();
      expect(r.reachable).toBeUndefined();
    });

    it('候选存在但非 online（stopped）→ 继续找后续候选 / 最终 online=false', async () => {
      const apps: Pm2App[] = [
        { name: 'web-todo-service', pm2_env: { status: 'stopped', PORT: 6200 } },
        { name: 'web-todo', pm2_env: { status: 'online', PORT: 6005 } },
      ];
      jest.spyOn(svc, 'listProcesses').mockReturnValue(apps);
      jest.spyOn(httpProbe, 'request').mockResolvedValue({ ok: true, status: 200, json: undefined });

      const r = await svc.probeOnce('todo-service');
      expect(r.online).toBe(true);
      expect(r.hit?.name).toBe('web-todo');
    });

    it('全部未 online → online=false，scans 记录各候选状态', async () => {
      jest.spyOn(svc, 'listProcesses').mockReturnValue([{ name: 'web-todo', pm2_env: { status: 'stopped' } }]);
      const r = await svc.probeOnce('todo-service', 'web-todo');
      expect(r.online).toBe(false);
      expect(r.scans.some((s) => s.name === 'web-todo' && s.status === 'stopped')).toBe(true);
    });

    it('pm2 查询异常向上抛（调用方按查询失败轮询）', async () => {
      jest.spyOn(svc, 'listProcesses').mockImplementation(() => {
        throw new Error('pm2 jlist 失败');
      });
      await expect(svc.probeOnce('todo-service')).rejects.toThrow('pm2 jlist 失败');
    });
  });
});
