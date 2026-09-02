import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { ConfigService } from './config.service';
import { decryptSecret, encryptSecret, SECRET_MASK } from './config-crypto';

/** 64 位 hex 主密钥（仅测试用） */
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ConfigService（配置中心）', () => {
  let service: ConfigService;
  let itemRepo: any;
  let snapRepo: any;

  beforeAll(() => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
  });

  beforeEach(async () => {
    itemRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    snapRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: getRepositoryToken(ConfigItemEntity), useValue: itemRepo },
        { provide: getRepositoryToken(ConfigSnapshotEntity), useValue: snapRepo },
      ],
    }).compile();
    service = moduleRef.get(ConfigService);
  });

  describe('密钥加解密', () => {
    it('加解密往返可还原明文，且密文不含明文', () => {
      const cipher = encryptSecret('db-pass-123');
      expect(cipher).not.toContain('db-pass-123');
      expect(decryptSecret(cipher)).toBe('db-pass-123');
    });

    it('同一明文两次加密结果不同（IV 随机）', () => {
      expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
    });

    it('密文被篡改时解密失败（GCM 认证）', () => {
      const [iv, tag] = encryptSecret('secret').split(':');
      const tampered = Buffer.from('tampered-data').toString('base64');
      expect(() => decryptSecret(`${iv}:${tag}:${tampered}`)).toThrow();
    });
  });

  describe('resolve：三级作用域合并', () => {
    it('模块级 > 环境级 > 全局', async () => {
      itemRepo.find.mockResolvedValue([
        { scope: 'global', key: 'PORT', value: '3000', isSecret: false },
        { scope: 'env', envId: 'dev', key: 'PORT', value: '4000', isSecret: false },
        { scope: 'module', envId: 'dev', moduleKey: 'auth', key: 'PORT', value: '5000', isSecret: false },
      ]);
      const cfg = await service.resolve('dev', 'auth');
      expect(cfg.PORT).toBe('5000');
    });

    it('缺失高层级时回落到低层级', async () => {
      itemRepo.find.mockResolvedValue([
        { scope: 'global', key: 'LOG_LEVEL', value: 'info', isSecret: false },
        { scope: 'env', envId: 'dev', key: 'PORT', value: '4000', isSecret: false },
      ]);
      const cfg = await service.resolve('dev', 'auth');
      expect(cfg.LOG_LEVEL).toBe('info');
      expect(cfg.PORT).toBe('4000');
    });

    it('密钥解密为明文供进程注入（仅供注入，不得回显）', async () => {
      itemRepo.find.mockResolvedValue([
        {
          scope: 'module',
          envId: 'dev',
          moduleKey: 'auth',
          key: 'DB_PASSWORD',
          value: encryptSecret('topsecret'),
          isSecret: true,
        },
      ]);
      const cfg = await service.resolve('dev', 'auth');
      expect(cfg.DB_PASSWORD).toBe('topsecret');
    });
  });

  describe('list：密钥掩码', () => {
    it('密钥只回显掩码，不回显明文', async () => {
      itemRepo.find.mockResolvedValue([
        {
          id: '1',
          scope: 'module',
          envId: 'dev',
          moduleKey: 'auth',
          key: 'DB_PASSWORD',
          value: encryptSecret('topsecret'),
          isSecret: true,
        },
      ]);
      const rows = await service.list();
      expect(rows[0].value).toBe(SECRET_MASK);
      expect(rows[0].value).not.toContain('topsecret');
    });
  });

  describe('upsert 校验', () => {
    it('非法作用域拒绝', async () => {
      await expect(
        service.upsert({ scope: 'bad' as any, key: 'A', value: '1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('配置键为空拒绝', async () => {
      await expect(service.upsert({ scope: 'global', key: '  ', value: '1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('环境级缺 envId 拒绝', async () => {
      await expect(service.upsert({ scope: 'env', key: 'A', value: '1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('模块级缺 moduleKey 拒绝', async () => {
      await expect(
        service.upsert({ scope: 'module', envId: 'dev', key: 'A', value: '1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('禁止把掩码当作密钥真实值写回', async () => {
      await expect(
        service.upsert({
          scope: 'module',
          envId: 'dev',
          moduleKey: 'auth',
          key: 'K',
          value: SECRET_MASK,
          isSecret: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('密钥加密落库，且可解密还原', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      itemRepo.create.mockImplementation((dto) => dto);
      itemRepo.save.mockImplementation(async (row) => row);

      const row = await service.upsert({
        scope: 'module',
        envId: 'dev',
        moduleKey: 'auth',
        key: 'DB_PASSWORD',
        value: 'topsecret',
        isSecret: true,
      });

      expect(row.value).not.toContain('topsecret');
      expect(decryptSecret(row.value)).toBe('topsecret');
    });
  });

  describe('snapshot / restore', () => {
    it('快照记录合并结果，且不落明文', async () => {
      const enc = encryptSecret('topsecret');
      itemRepo.find.mockResolvedValue([
        { scope: 'global', key: 'PORT', value: '3000', isSecret: false },
        { scope: 'module', envId: 'dev', moduleKey: 'auth', key: 'DB_PASSWORD', value: enc, isSecret: true },
      ]);
      snapRepo.create.mockImplementation((dto) => dto);
      snapRepo.save.mockImplementation(async (row) => row);

      const snap = await service.snapshot('dev', 'auth', 'v1');

      expect(snap.payload.PORT.value).toBe('3000');
      expect(snap.payload.DB_PASSWORD.value).toBe(enc);
      expect(JSON.stringify(snap.payload)).not.toContain('topsecret');
    });

    it('回滚把快照写回模块级配置', async () => {
      snapRepo.findOne.mockResolvedValue({
        payload: { A: { value: 'old', isSecret: false, source: 'module' } },
      });
      itemRepo.findOne.mockResolvedValue(null);
      itemRepo.create.mockImplementation((dto) => dto);
      itemRepo.save.mockImplementation(async (row) => row);

      await expect(service.restore('dev', 'auth', 'v1')).resolves.toBe(1);
    });

    it('无快照可回滚时返回 0 而不是抛错', async () => {
      snapRepo.findOne.mockResolvedValue(null);
      await expect(service.restore('dev', 'auth', 'nope')).resolves.toBe(0);
    });
  });
});
