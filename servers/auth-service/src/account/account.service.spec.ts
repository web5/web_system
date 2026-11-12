/**
 * 账号绑定与合并（AccountService）单测
 *
 * 聚焦 bug #10：confirmMerge=true 的二次请求命中冲突时必须转入 mergeInto 合并，
 * 而不是无条件返回 conflict。覆盖 phone / email 两条链路（共用 bindByValue/mergeInto）。
 */
import { ConfigService } from '@nestjs/config';
import { RedisService } from '@liaoliaots/nestjs-redis';
import { DataSource } from 'typeorm';
import axios from 'axios';
import { AccountService } from './account.service';
import { AuthService } from '../auth/auth.service';
import { WechatMpService } from './wechat-mp.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AccountService', () => {
  let service: AccountService;
  let authService: { generateTokenForUser: jest.Mock };
  let wechatMp: { getPhoneNumber: jest.Mock };
  let configService: { get: jest.Mock };
  let redisService: { getOrThrow: jest.Mock };
  let redisClient: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let dataSource: { query: jest.Mock; createQueryRunner: jest.Mock };
  let runner: {
    connect: jest.Mock;
    startTransaction: jest.Mock;
    query: jest.Mock;
    commitTransaction: jest.Mock;
    rollbackTransaction: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    authService = { generateTokenForUser: jest.fn() };
    wechatMp = { getPhoneNumber: jest.fn() };
    configService = { get: jest.fn() };
    redisClient = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    redisService = { getOrThrow: jest.fn().mockReturnValue(redisClient) };
    runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSource = {
      query: jest.fn(),
      createQueryRunner: jest.fn().mockReturnValue(runner),
    };

    service = new AccountService(
      authService as unknown as AuthService,
      wechatMp as unknown as WechatMpService,
      configService as unknown as ConfigService,
      redisService as unknown as RedisService,
      dataSource as unknown as DataSource,
    );
  });

  describe('bindPhone - 首次绑定（无 confirmMerge）', () => {
    it('无冲突时直接落库并返回 bound', async () => {
      wechatMp.getPhoneNumber.mockResolvedValue('13812345678');
      dataSource.query.mockResolvedValueOnce([]); // 无冲突

      const result = await service.bindPhone(1, 'wx_code', false);

      expect(result).toMatchObject({ conflict: false, bound: true, source: 'phone', phone: '138****5678' });
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('命中冲突时暂存 pending 并返回 conflict', async () => {
      wechatMp.getPhoneNumber.mockResolvedValue('13812345678');
      dataSource.query.mockResolvedValueOnce([{ id: 2, status: 'active' }]); // 冲突目标

      const result = await service.bindPhone(1, 'wx_code', false);

      expect(result).toMatchObject({ conflict: true, canMerge: true, source: 'phone', maskedValue: '138****5678' });
      expect(redisClient.set).toHaveBeenCalledWith(
        'bind_pending:1',
        expect.stringContaining('"source":"phone"'),
        'EX',
        expect.any(Number),
      );
    });
  });

  describe('confirmMerge=true - 命中冲突应走合并', () => {
    it('phone 链路：合并成功返回 merged 与新凭证', async () => {
      redisClient.get.mockResolvedValue(JSON.stringify({ source: 'phone', value: '13812345678' }));
      dataSource.query.mockResolvedValueOnce([{ id: 2, status: 'active' }]); // 冲突目标
      runner.query
        .mockResolvedValueOnce([{ id: 2, status: 'active', mp_openid: null }]) // mergeInto 查目标
        .mockResolvedValueOnce([{ id: 1, mp_openid: 'openid_1', merged_to: null }]); // mergeInto 查源
      runner.query.mockResolvedValue({ affectedRows: 0 }); // 迁移/落库默认返回
      authService.generateTokenForUser.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });

      const result = await service.bindPhone(1, undefined, true);

      expect(result).toMatchObject({ conflict: false, merged: true, source: 'phone', accessToken: 'at' });
      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(runner.commitTransaction).toHaveBeenCalled();
    });

    it('email 链路：合并成功返回 merged 与新凭证', async () => {
      redisClient.get.mockResolvedValue(JSON.stringify({ source: 'email', value: 'target@example.com' }));
      dataSource.query.mockResolvedValueOnce([{ id: 2, status: 'active' }]); // 冲突目标
      runner.query
        .mockResolvedValueOnce([{ id: 2, status: 'active', mp_openid: null }])
        .mockResolvedValueOnce([{ id: 1, mp_openid: 'openid_1', merged_to: null }]);
      runner.query.mockResolvedValue({ affectedRows: 0 });
      authService.generateTokenForUser.mockResolvedValue({ accessToken: 'at2', refreshToken: 'rt2', expiresIn: 3600 });

      const result = await service.bindEmail(1, 'target@example.com', '123456', true);

      expect(result).toMatchObject({ conflict: false, merged: true, source: 'email', accessToken: 'at2' });
      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(runner.commitTransaction).toHaveBeenCalled();
    });
  });

  /**
   * verifyEmailCodeWithUserService 信封兼容（bug 根因回归哨兵）：
   * user-service 全局 TransformInterceptor 把 2xx 包成 {code, data, message:'success'}，
   * 未解信封时 data.ok 恒 undefined → dev 绑定邮箱 100% 抛 BadRequestException('success')。
   */
  describe('bindEmail - verifyEmailCodeWithUserService 解信封', () => {
    it('信封 {code:0,data:{ok:true},message:"success"}（现网形态）→ 通过不抛，继续落库', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { ok: true }, message: 'success' },
      });
      dataSource.query.mockResolvedValueOnce([]); // 无冲突

      const result = await service.bindEmail(1, 'a@example.com', '123456', false);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/internal/users/email/verify'),
        { email: 'a@example.com', code: '123456', userId: 1 },
        expect.objectContaining({ headers: { 'x-internal-key': expect.any(String) } }),
      );
      expect(result).toMatchObject({ conflict: false, bound: true, source: 'email' });
    });

    it('信封 {code:0,data:{ok:false,message:"验证码错误或已过期"}} → 抛中文文案，不落库', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { code: 0, data: { ok: false, message: '验证码错误或已过期' }, message: 'success' },
      });

      await expect(service.bindEmail(1, 'a@example.com', '000000', false)).rejects.toThrow(
        '验证码错误或已过期',
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('裸返回 {ok:true}（无信封，向后兼容）→ 通过不抛', async () => {
      mockedAxios.post.mockResolvedValue({ data: { ok: true } });
      dataSource.query.mockResolvedValueOnce([]); // 无冲突

      const result = await service.bindEmail(1, 'a@example.com', '123456', false);

      expect(result).toMatchObject({ conflict: false, bound: true, source: 'email' });
    });
  });
});
