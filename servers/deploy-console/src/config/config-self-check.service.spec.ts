import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigItemEntity } from '../entities/config-item.entity';
import { ConfigSelfCheckService } from './config-self-check.service';
import { encryptSecret, resetMasterKeyCache } from './config-crypto';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999';

describe('ConfigSelfCheckService（启动期主密钥自检）', () => {
  let service: ConfigSelfCheckService;
  let repo: { findOne: jest.Mock };
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    repo = { findOne: jest.fn() };
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigSelfCheckService,
        { provide: getRepositoryToken(ConfigItemEntity), useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ConfigSelfCheckService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    resetMasterKeyCache();
    delete process.env.CONFIG_MASTER_KEY;
    delete process.env.CONFIG_MASTER_KEY_FILE;
  });

  const secretRow = (value: string) =>
    ({ scope: 'module', envId: 'local', moduleKey: 'ai-agent', key: 'HY3_API_KEY', value }) as ConfigItemEntity;

  it('密钥与库匹配：不退出，日志含指纹与抽样结果', async () => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    repo.findOne.mockResolvedValue(secretRow(encryptSecret('real-secret')));

    await service.onApplicationBootstrap();

    expect(exitSpy).not.toHaveBeenCalled();
    const line = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toMatch(/主密钥就绪 fp=[0-9a-f]{8} source=env 抽样可解=1\/1/);
  });

  it('密钥与本库不匹配（GCM 失败）：FATAL 并 exit(1)（K3 启动即失败）', async () => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    const cipherWrittenByTestKey = encryptSecret('real-secret');
    resetMasterKeyCache();
    process.env.CONFIG_MASTER_KEY = OTHER_KEY;
    repo.findOne.mockResolvedValue(secretRow(cipherWrittenByTestKey));

    await service.onApplicationBootstrap();

    expect(exitSpy).toHaveBeenCalledWith(1);
    const err = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(err).toMatch(/FATAL 主密钥与本库不匹配/);
    expect(err).toMatch(/修复：/);
  });

  it('配置库不可达：只告警、不退出（避免 DB 抖动导致反复被杀）', async () => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    repo.findOne.mockRejectedValue(new Error('ECONNREFUSED'));

    await service.onApplicationBootstrap();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/配置库暂不可达/);
  });

  it('库中暂无密钥项：放行（不因缺钥硬拦新环境）', async () => {
    repo.findOne.mockResolvedValue(null);

    await service.onApplicationBootstrap();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/暂无 is_secret 项/);
  });
});
