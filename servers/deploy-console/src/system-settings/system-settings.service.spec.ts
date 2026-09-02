import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SystemSettingEntity } from '../entities/system-setting.entity';
import {
  SystemSettingsService,
  NOTIFY_WEBHOOK_URL_KEY,
  NOTIFY_WECOM_URL_KEY,
} from './system-settings.service';

describe('SystemSettingsService', () => {
  let service: SystemSettingsService;
  let repo: any;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SystemSettingsService,
        { provide: getRepositoryToken(SystemSettingEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(SystemSettingsService);
  });

  describe('get / set', () => {
    it('空串视为未配置', async () => {
      repo.findOne.mockResolvedValue({ settingKey: 'K', settingValue: '' });
      await expect(service.get('K')).resolves.toBeNull();
    });

    it('有值返回', async () => {
      repo.findOne.mockResolvedValue({ settingKey: 'K', settingValue: 'v' });
      await expect(service.get('K')).resolves.toBe('v');
    });

    it('保存用 upsert（key 为主键）', async () => {
      await service.set('K', 'v', 'alice');
      expect(repo.upsert).toHaveBeenCalledWith(
        { settingKey: 'K', settingValue: 'v', updatedBy: 'alice' },
        { conflictPaths: ['settingKey'] },
      );
    });
  });

  describe('notifyChannels：DB 优先、env 兜底', () => {
    it('DB 无值且 env 有值时用 env（兼容迁移前部署）', async () => {
      repo.find.mockResolvedValue([]);
      const env = (k: string) =>
        k === NOTIFY_WEBHOOK_URL_KEY ? 'https://env.hook' : undefined;
      await expect(service.notifyChannels(env)).resolves.toEqual({
        webhook: 'https://env.hook',
        wecom: null,
      });
    });

    it('页面配置过则 DB 覆盖 env', async () => {
      repo.find.mockResolvedValue([
        { settingKey: NOTIFY_WEBHOOK_URL_KEY, settingValue: 'https://db.hook' },
      ]);
      const env = (k: string) =>
        k === NOTIFY_WEBHOOK_URL_KEY ? 'https://env.hook' : undefined;
      await expect(service.notifyChannels(env)).resolves.toEqual({
        webhook: 'https://db.hook',
        wecom: null,
      });
    });

    it('DB 存了空串时回落到 env', async () => {
      repo.find.mockResolvedValue([
        { settingKey: NOTIFY_WEBHOOK_URL_KEY, settingValue: '' },
      ]);
      const env = (k: string) =>
        k === NOTIFY_WEBHOOK_URL_KEY ? 'https://env.hook' : undefined;
      await expect(service.notifyChannels(env)).resolves.toEqual({
        webhook: 'https://env.hook',
        wecom: null,
      });
    });
  });

  describe('setNotifyChannels', () => {
    it('分别保存两个通道', async () => {
      await service.setNotifyChannels({ webhook: 'a', wecom: 'b' }, 'alice');
      expect(repo.upsert).toHaveBeenCalledTimes(2);
    });

    it('undefined 字段不动（允许只改一个）', async () => {
      await service.setNotifyChannels({ webhook: 'a' });
      expect(repo.upsert).toHaveBeenCalledTimes(1);
      const [row] = repo.upsert.mock.calls[0];
      expect(row.settingKey).toBe(NOTIFY_WEBHOOK_URL_KEY);
    });

    it('空串用于关闭通道', async () => {
      await service.setNotifyChannels({ wecom: '' });
      const [row] = repo.upsert.mock.calls[0];
      expect(row.settingKey).toBe(NOTIFY_WECOM_URL_KEY);
      expect(row.settingValue).toBe('');
    });
  });
});
