import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationLogEntity } from '../entities/notification-log.entity';
import { NotificationService, formatNotifyText } from './notification.service';

describe('formatNotifyText（纯函数）', () => {
  it('成功事件含绿色图标与关键字段', () => {
    const text = formatNotifyText({
      event: 'pipeline.succeeded',
      env: 'dev',
      moduleKey: 'auth-service',
      versionTag: 'abc123',
      status: 'success',
      detail: '发布成功',
    });
    expect(text).toContain('✅');
    expect(text).toContain('auth-service');
    expect(text).toContain('abc123');
  });

  it('失败事件含红色图标与错误摘要', () => {
    const text = formatNotifyText({
      event: 'pipeline.failed',
      env: 'dev',
      moduleKey: 'auth-service',
      status: 'failed',
      detail: 'build 阶段失败',
    });
    expect(text).toContain('❌');
    expect(text).toContain('build 阶段失败');
  });
});

describe('NotificationService', () => {
  let service: NotificationService;
  let repo: any;
  let config: { get: jest.Mock };

  beforeEach(async () => {
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'n1' })),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    };
    config = { get: jest.fn().mockReturnValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getRepositoryToken(NotificationLogEntity), useValue: repo },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(NotificationService);
  });

  describe('channels', () => {
    it('未配置通道时返回空', () => {
      expect(service.channels()).toEqual({ webhook: null, wecom: null });
    });

    it('读取环境变量配置', () => {
      config.get.mockImplementation((k: string) =>
        k === 'NOTIFY_WEBHOOK_URL' ? 'https://hook.example' : undefined,
      );
      expect(service.channels().webhook).toBe('https://hook.example');
    });
  });

  describe('notify', () => {
    it('写入站内记录（事件/环境/模块/内容）', async () => {
      await service.notify({
        event: 'pipeline.succeeded',
        env: 'dev',
        moduleKey: 'auth-service',
        status: 'success',
        detail: '发布成功',
      });
      expect(repo.save).toHaveBeenCalled();
      const [row] = repo.save.mock.calls[0];
      expect(row.event).toBe('pipeline.succeeded');
      expect(row.delivery).toEqual({});
    });

    it('无通道配置时只记录不推送、不报错', async () => {
      await expect(
        service.notify({
          event: 'pipeline.failed',
          env: 'dev',
          moduleKey: 'auth-service',
          status: 'failed',
          detail: 'x',
        }),
      ).resolves.toBeUndefined();
    });

    it('DB 写入失败也吞掉（通知不能成为发布的前置依赖）', async () => {
      repo.save.mockRejectedValue(new Error('db down'));
      await expect(
        service.notify({
          event: 'pipeline.failed',
          env: 'dev',
          moduleKey: 'auth-service',
          status: 'failed',
          detail: 'x',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('list', () => {
    it('限制上限，避免异常入参', async () => {
      repo.find.mockResolvedValue([]);
      await service.list(99999);
      // find 只接收一个参数对象（options），因此解构第一个元素即可
      const [opts] = repo.find.mock.calls[0];
      expect(opts.take).toBe(200);
    });

    it('按时间倒序', async () => {
      await service.list();
      const [opts] = repo.find.mock.calls[0];
      expect(opts.order.createdAt).toBe('DESC');
    });
  });
});
