import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { ConfigSnapshotEntity } from '../entities/config-snapshot.entity';
import { ConfigService } from './config.service';
import {
  escapeEnvValue,
  isReservedLocalKey,
  renderGeneratedEnvFile,
} from './config.service';
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
      count: jest.fn().mockResolvedValue(0),
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

  /**
   * P0-1（`specs/service-config-delivery/design.md` §4.4）：
   * 「配置解析按用途拆分」—— 密钥只能出现在**下发给进程**的路径上，
   * **绝不能进流水线脚本 env**（否则等于把加密存储换成每次执行都摊在环境变量里）。
   */
  describe('P0-1 按用途解析（密钥隔离）', () => {
    const ROWS = () => [
      { scope: 'global', key: 'REPO_URL', value: 'git@github.com:web5/web_system.git', isSecret: false },
      { scope: 'env', envId: 'local', key: 'PORT', value: '6010', isSecret: false },
      {
        scope: 'module',
        envId: 'local',
        moduleKey: 'gateway',
        key: 'GATEWAY_SERVICE_KEY',
        value: encryptSecret('svc-key-123'),
        isSecret: true,
      },
    ];

    it('resolveForScripts 不含密钥（V3），resolveForProcess 含明文', async () => {
      itemRepo.find.mockResolvedValue(ROWS());

      const forScripts = await service.resolveForScripts('local', 'gateway');
      expect(forScripts.PORT).toBe('6010');
      expect(forScripts).not.toHaveProperty('GATEWAY_SERVICE_KEY');

      const forProcess = await service.resolveForProcess('local', 'gateway');
      expect(forProcess.GATEWAY_SERVICE_KEY).toBe('svc-key-123');
    });

    it('resolveForScriptsDetailed 回报被排除的密钥键（发布日志「已排除 N 个密钥项」）', async () => {
      itemRepo.find.mockResolvedValue(ROWS());
      const r = await service.resolveForScriptsDetailed('local', 'gateway');
      expect(r.excludedSecrets).toEqual(['GATEWAY_SERVICE_KEY']);
      expect(Object.keys(r.config).sort()).toEqual(['PORT', 'REPO_URL']);
    });

    it('dispatchPayload 带来源作用域，并过滤保留键（引导/基础设施/平台键）', async () => {
      itemRepo.find.mockResolvedValue([
        ...ROWS(),
        { scope: 'global', key: 'CONFIG_MASTER_KEY', value: 'master', isSecret: true },
        {
          scope: 'module',
          envId: 'local',
          moduleKey: 'gateway',
          key: 'MYSQL_PASSWORD',
          value: 'pwd',
          isSecret: false,
        },
        {
          scope: 'module',
          envId: 'local',
          moduleKey: 'gateway',
          key: 'PM2_NAME',
          value: 'web-gateway',
          isSecret: false,
        },
      ]);

      const items = await service.dispatchPayload('local', 'gateway');
      expect(items.map((i) => i.key).sort()).toEqual(['GATEWAY_SERVICE_KEY', 'PORT', 'REPO_URL']);

      const secret = items.find((i) => i.key === 'GATEWAY_SERVICE_KEY');
      expect(secret?.value).toBe('svc-key-123');
      expect(secret?.scope).toBe('module:local/gateway');
      expect(items.find((i) => i.key === 'PORT')?.scope).toBe('env:local');
      expect(items.find((i) => i.key === 'REPO_URL')?.scope).toBe('global');
    });

    it('hasModuleScope：按需下发的判据（design Q1）', async () => {
      itemRepo.count.mockResolvedValue(1);
      await expect(service.hasModuleScope('local', 'gateway')).resolves.toBe(true);
      itemRepo.count.mockResolvedValue(0);
      await expect(service.hasModuleScope('local', 'gateway')).resolves.toBe(false);
    });
  });

  describe('renderGeneratedEnvFile（下发文件渲染）', () => {
    it('头部写来源/环境/回退说明，逐键标来源作用域', () => {
      const text = renderGeneratedEnvFile(
        [
          { key: 'PORT', value: '6010', scope: 'env:local' },
          { key: 'GATEWAY_SERVICE_KEY', value: 'svc-key-123', scope: 'module:local/gateway' },
        ],
        { envId: 'local', serviceKey: 'gateway', generatedAt: new Date('2026-09-21T00:00:00Z') },
      );
      expect(text).toContain('# 服务: gateway    环境: local');
      expect(text).toContain('# 生成时间: 2026-09-21T00:00:00.000Z');
      expect(text).toContain('# [env:local]\nPORT=6010');
      expect(text).toContain('# [module:local/gateway]\nGATEWAY_SERVICE_KEY=svc-key-123');
      expect(text).toContain('删除本文件 + 重启服务');
    });

    it('含空格/引号/换行的值转义（不会把 .env.generated 写坏）', () => {
      expect(escapeEnvValue('plain-key-123')).toBe('plain-key-123');
      expect(escapeEnvValue('a b')).toBe('"a b"');
      expect(escapeEnvValue('a"b')).toBe('"a\\"b"');
      expect(escapeEnvValue('a\nb')).toBe('"a\\nb"');
      expect(escapeEnvValue('')).toBe('""');
    });

    it('保留键判定支持前缀通配', () => {
      expect(isReservedLocalKey('CONFIG_MASTER_KEY')).toBe(true);
      expect(isReservedLocalKey('MYSQL_PASSWORD')).toBe(true);
      expect(isReservedLocalKey('PM2_SCRIPT')).toBe(true);
      expect(isReservedLocalKey('GATEWAY_SERVICE_KEY')).toBe(false);
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
