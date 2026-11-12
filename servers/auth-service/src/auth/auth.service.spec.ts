import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';
import axios from 'axios';
import { PublicBaseUrlService } from '@web-system/shared';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { User } from '../user/user.entity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  // 不用 jest.Mocked<Partial<X>>：Partial 让成员变成可选，@types/jest 的 Mocked
  // 只包装**必填**函数成员，可选成员会保留原始函数签名 → 拿不到 mockResolvedValue
  // （依赖小版本漂移即翻车，CI 时红时绿）。这里改成必填类型 + 赋值处显式断言。
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;
  let redisService: jest.Mocked<RedisService>;
  /** 默认 Redis 客户端替身（登出黑名单 set/exists 走它） */
  let redisClient: { set: jest.Mock; exists: jest.Mock; get: jest.Mock };

  // 测试夹具只覆盖断言用到的字段，用断言对齐 User 实体（逐字段补齐会随实体演进而腐化）
  const mockUser = {
    id: 1,
    username: 'test_user',
    password: '$2a$10$hashedpassword',
    email: null,
    phone: null,
    nickname: 'Test',
    avatar: '',
    gender: 'unknown' as const,
    mpOpenid: null,
    oaOpenid: null,
    status: 'active' as const,
    roles: ['user'],
    dailyTransformLimit: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as User;

  const mockToken = 'mock.jwt.token';
  const mockRefreshToken = 'mock.refresh.token';

  beforeEach(async () => {
    userService = {
      findByUsername: jest.fn(),
      findById: jest.fn(),
      findByMpOpenid: jest.fn(),
      findByOaOpenid: jest.fn(),
      create: jest.fn(),
      createMpUser: jest.fn(),
      createOaUser: jest.fn(),
      bindMpOpenid: jest.fn(),
      bindOaOpenid: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn().mockReturnValue(null),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn() as any,
    } as unknown as jest.Mocked<ConfigService>;

    redisClient = { set: jest.fn(), exists: jest.fn(), get: jest.fn() };
    redisService = {
      getOrThrow: jest.fn().mockReturnValue(redisClient),
    } as unknown as jest.Mocked<RedisService>;
    (configService.get as jest.Mock).mockImplementation((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        MINI_PROGRAM_APP_ID: 'mp_appid',
        MINI_PROGRAM_SECRET: 'mp_secret',
        OFFICIAL_ACCOUNT_APP_ID: 'oa_appid',
        OFFICIAL_ACCOUNT_SECRET: 'oa_secret',
        JWT_EXPIRES_IN: '7d',
        WECHAT_OAUTH_REDIRECT_URI: 'https://example.com/api/auth/wechat/callback',
      };
      return config[key] ?? defaultValue;
    });

    // 默认 bcrypt.compare 返回 true（密码正确）
    (require('bcryptjs').compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redisService },
        { provide: PublicBaseUrlService, useValue: { resolve: jest.fn().mockResolvedValue('') } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

    // mock JWT sign
    (jwtService.signAsync as jest.Mock).mockResolvedValue(mockToken);
    (jwtService.signAsync as jest.Mock).mockResolvedValueOnce(mockToken);
    (jwtService.signAsync as jest.Mock).mockResolvedValueOnce(mockRefreshToken);
  });

  // ============ 用户名密码登录 ============

  describe('login', () => {
    it('用户名密码正确时应返回 token', async () => {
      userService.findByUsername.mockResolvedValue(mockUser);

      const result = await service.login({ username: 'test_user', password: 'password123' });

      expect(result.accessToken).toBe(mockToken);
      expect(result.user.id).toBe(1);
    });

    it('密码错误时应抛出 UnauthorizedException', async () => {
      (require('bcryptjs').compare as jest.Mock).mockResolvedValue(false);
      userService.findByUsername.mockResolvedValue(mockUser);

      await expect(
        service.login({ username: 'test_user', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('用户不存在时应抛出 UnauthorizedException', async () => {
      userService.findByUsername.mockResolvedValue(null);
      await expect(
        service.login({ username: 'nonexistent', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('用户被禁用时应抛出 UnauthorizedException', async () => {
      userService.findByUsername.mockResolvedValue({ ...mockUser, status: 'banned' });
      await expect(
        service.login({ username: 'banned_user', password: 'pw' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ============ 公众号 OAuth 登录 ============

  describe('wechatLogin', () => {
    const oauthTokenResponse = {
      data: {
        access_token: 'oa_access_token',
        openid: 'oa_openid_123',
      },
    };
    const userInfoResponse = {
      data: {
        openid: 'oa_openid_123',
        nickname: '公众号用户',
        headimgurl: 'https://example.com/avatar.png',
      },
    };

    it('新用户应通过公众号 OAuth 创建账号', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(oauthTokenResponse)
        .mockResolvedValueOnce(userInfoResponse);

      userService.findByOaOpenid.mockResolvedValue(null);
      userService.createOaUser.mockResolvedValue({
        ...mockUser,
        oaOpenid: 'oa_openid_123',
        nickname: '公众号用户',
      });

      const result = await service.wechatLogin({ code: 'oauth_code_123' });

      expect(result.accessToken).toBe(mockToken);
      expect(userService.createOaUser).toHaveBeenCalledWith(
        expect.objectContaining({ oaOpenid: 'oa_openid_123' }),
      );
    });

    it('已有公众号用户应直接登录', async () => {
      mockedAxios.get
        .mockResolvedValueOnce(oauthTokenResponse)
        .mockResolvedValueOnce(userInfoResponse);

      userService.findByOaOpenid.mockResolvedValue({
        ...mockUser,
        oaOpenid: 'oa_openid_123',
        id: 5,
      });

      const result = await service.wechatLogin({ code: 'oauth_code_123' });

      expect(result.user.id).toBe(5);
      expect(userService.createOaUser).not.toHaveBeenCalled();
    });

    it('微信接口返回错误时应抛出 BadRequestException', async () => {
      mockedAxios.get.mockRejectedValue(new Error('微信接口超时'));

      await expect(service.wechatLogin({ code: 'bad_code' })).rejects.toThrow(BadRequestException);
    });

    // ---- 安全回归：任意假 code 越权拿 admin token ----
    // 原实现两处根因叠加：①oauth2/access_token 响应未判 errcode（code 无效时
    // access_token/openid 为 undefined，流程继续）；②findByOaOpenid(undefined)
    // 触发 TypeORM 静默忽略 where 条件 → 退化为无条件查询 → 返回 users 表第一行（admin）。
    it('微信 access_token 返回 errcode（40029/40125）时必须拒绝，不查库、不签发 token', async () => {
      for (const errcode of [40029, 40125]) {
        mockedAxios.get.mockResolvedValueOnce({
          data: { errcode, errmsg: 'invalid code' },
        });

        await expect(service.wechatLogin({ code: 'fake_code' })).rejects.toThrow(
          BadRequestException,
        );
      }
      expect(userService.findByOaOpenid).not.toHaveBeenCalled();
      expect(userService.createOaUser).not.toHaveBeenCalled();
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it.each([
      ['openid 缺失', { access_token: 'oa_access_token' }],
      ['openid 为空串', { access_token: 'oa_access_token', openid: '' }],
      ['access_token 缺失', { openid: 'oa_openid_123' }],
      ['两者皆缺', {}],
    ])(
      'access_token 响应无 errcode 但 %s 时必须拒绝，绝不进 findByOaOpenid',
      async (_label, tokenData) => {
        mockedAxios.get.mockResolvedValue({ data: tokenData });

        await expect(service.wechatLogin({ code: 'fake_code' })).rejects.toThrow(
          BadRequestException,
        );
        expect(userService.findByOaOpenid).not.toHaveBeenCalled();
        expect(userService.createOaUser).not.toHaveBeenCalled();
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      },
    );
  });

  // ============ 小程序登录 ============

  describe('miniprogramLogin', () => {
    const jscode2sessionResponse = {
      data: {
        openid: 'mp_openid_456',
        session_key: 'mock_session_key',
      },
    };

    it('新用户应通过小程序 code 创建账号', async () => {
      mockedAxios.get.mockResolvedValue(jscode2sessionResponse);
      userService.findByMpOpenid.mockResolvedValue(null);
      userService.createMpUser.mockResolvedValue({
        ...mockUser,
        mpOpenid: 'mp_openid_456',
      });

      const result = await service.miniprogramLogin({
        code: 'mp_code_123',
        nickname: '小程序用户',
        avatar: '',
      });

      expect(result.accessToken).toBe(mockToken);
      expect(result.isNewUser).toBe(true);
      expect(userService.createMpUser).toHaveBeenCalledWith(
        expect.objectContaining({ mpOpenid: 'mp_openid_456' }),
      );
    });

    it('已有小程序用户应直接登录', async () => {
      mockedAxios.get.mockResolvedValue(jscode2sessionResponse);
      userService.findByMpOpenid.mockResolvedValue({
        ...mockUser,
        mpOpenid: 'mp_openid_456',
        id: 3,
      });

      const result = await service.miniprogramLogin({
        code: 'mp_code_123',
        nickname: '已有用户',
        avatar: '',
      });

      expect(result.user.id).toBe(3);
      expect(result.isNewUser).toBe(false);
      expect(userService.createMpUser).not.toHaveBeenCalled();
    });

    it('微信接口返回错误码时应抛出 BadRequestException', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { errcode: 40029, errmsg: 'invalid code' },
      });

      await expect(
        service.miniprogramLogin({ code: 'bad_code', nickname: '', avatar: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    // 安全回归：errcode 缺省但 openid 缺失/为空时，绝不能让 undefined/空串
    // 进入 findByMpOpenid（TypeORM 会静默忽略值为 undefined 的 where 条件）
    it.each([
      ['openid 缺失', { session_key: 'mock_key' }],
      ['openid 为空串', { session_key: 'mock_key', openid: '' }],
    ])(
      'jscode2session 无 errcode 但 %s 时必须拒绝且不查库、不签发 token',
      async (_label, sessionData) => {
        mockedAxios.get.mockResolvedValue({ data: sessionData });

        await expect(
          service.miniprogramLogin({ code: 'fake_code', nickname: '', avatar: '' }),
        ).rejects.toThrow(BadRequestException);
        expect(userService.findByMpOpenid).not.toHaveBeenCalled();
        expect(userService.createMpUser).not.toHaveBeenCalled();
        expect(jwtService.signAsync).not.toHaveBeenCalled();
      },
    );
  });

  // ============ 绑定方法 ============

  describe('bindMpOpenid', () => {
    it('应通过 code 绑定小程序 openid 到用户', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { openid: 'mp_bind_openid' },
      });
      userService.bindMpOpenid.mockResolvedValue(mockUser as any);

      await service.bindMpOpenid(1, 'wx_login_code');

      expect(userService.bindMpOpenid).toHaveBeenCalledWith(1, 'mp_bind_openid');
    });

    it('微信接口返回错误时应抛出异常', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { errcode: 40029, errmsg: 'invalid code' },
      });

      await expect(service.bindMpOpenid(1, 'bad_code')).rejects.toThrow(BadRequestException);
    });

    it('微信响应无 errcode 但缺 openid 时必须拒绝且不调用绑定', async () => {
      mockedAxios.get.mockResolvedValue({ data: { session_key: 'mock_key' } });

      await expect(service.bindMpOpenid(1, 'fake_code')).rejects.toThrow(BadRequestException);
      expect(userService.bindMpOpenid).not.toHaveBeenCalled();
    });
  });

  describe('bindOaOpenid', () => {
    it('应通过 code 绑定公众号 openid 到用户', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { access_token: 'token', openid: 'oa_bind_openid' },
      });
      userService.bindOaOpenid.mockResolvedValue(mockUser as any);

      await service.bindOaOpenid(1, 'oauth_code');

      expect(userService.bindOaOpenid).toHaveBeenCalledWith(1, 'oa_bind_openid');
    });

    it('微信接口返回错误时应抛出异常', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { errcode: 40029, errmsg: 'invalid code' },
      });

      await expect(service.bindOaOpenid(1, 'bad_code')).rejects.toThrow(BadRequestException);
    });

    it('微信响应无 errcode 但缺 openid 时必须拒绝且不调用绑定', async () => {
      mockedAxios.get.mockResolvedValue({ data: { access_token: 'token' } });

      await expect(service.bindOaOpenid(1, 'fake_code')).rejects.toThrow(BadRequestException);
      expect(userService.bindOaOpenid).not.toHaveBeenCalled();
    });
  });

  // ============ 其他方法 ============

  describe('refreshToken', () => {
    it('有效的 refresh token 应返回新 token', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 1 });
      userService.findById.mockResolvedValue(mockUser);

      const result = await service.refreshToken('valid_refresh_token');

      expect(result.accessToken).toBe(mockToken);
    });

    it('无效的 refresh token 应抛出 UnauthorizedException', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('jwt expired'));

      await expect(service.refreshToken('invalid_token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('verifyToken', () => {
    it('有效 token 应返回用户信息', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 1 });
      userService.findById.mockResolvedValue(mockUser);

      const result = await service.verifyToken('valid_token');

      expect(result.id).toBe(1);
      expect(result.username).toBe('test_user');
    });

    it('token 无效应抛出 UnauthorizedException', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('invalid'));

      await expect(service.verifyToken('bad_token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('buildWechatOAuthUrl', () => {
    it('应生成正确的公众号 OAuth URL', () => {
      const url = service.buildWechatOAuthUrl('https://frontend.com/login');

      expect(url).toContain('open.weixin.qq.com/connect/oauth2/authorize');
      expect(url).toContain('appid=oa_appid');
      expect(url).toContain('redirect_uri=');
      expect(url).toContain('scope=snsapi_userinfo');
      expect(url).toContain('#wechat_redirect');
    });
  });

  describe('register', () => {
    it('应注册新用户并返回 token', async () => {
      userService.create.mockResolvedValue(mockUser);

      const result = await service.register({
        username: 'new_user',
        password: 'password123',
      });

      expect(result.accessToken).toBe(mockToken);
    });
  });

  describe('V4：Redis 黑名单只允许成功后形成结论', () => {
    it.each([
      [0, false],
      [1, true],
    ])('无 sid token 的 exists=%s 返回 %s', async (exists, expected) => {
      redisClient.exists.mockResolvedValue(exists);

      await expect(service.isTokenBlacklisted('test-token')).resolves.toBe(expected);
      expect(redisClient.exists).toHaveBeenCalledTimes(1);
    });

    it.each([
      [1, 0, true],
      [0, 1, true],
      [0, 0, false],
    ])('有 sid 时 hash=%s、sid=%s 返回 %s', async (byHash, bySid, expected) => {
      (jwtService.decode as jest.Mock).mockReturnValue({ sid: 'test-session' });
      redisClient.exists.mockResolvedValueOnce(byHash).mockResolvedValueOnce(bySid);

      await expect(service.isTokenBlacklisted('test-token')).resolves.toBe(expected);
      expect(redisClient.exists).toHaveBeenCalledTimes(2);
    });

    it('exists 命令失败必须抛 503，不得 fail-open 为 false', async () => {
      redisClient.exists.mockRejectedValue(new Error('test command unavailable'));

      await expect(service.isTokenBlacklisted('test-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('获取 Redis 客户端失败必须抛 503，不得 fail-open 为 false', async () => {
      (redisService.getOrThrow as jest.Mock).mockImplementation(() => {
        throw new Error('test client unavailable');
      });

      await expect(service.isTokenBlacklisted('test-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('V9：logout 黑名单写入语义', () => {
    it('正常登出同时写入 token 与 sid 黑名单', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      (jwtService.decode as jest.Mock).mockReturnValue({
        exp: nowSec + 60,
        sid: 'test-session',
      });
      redisClient.set.mockResolvedValue('OK');

      await expect(service.logout('test-token')).resolves.toBeUndefined();
      expect(redisClient.set).toHaveBeenCalledTimes(2);
    });

    it('黑名单写入失败必须抛 503，不得静默返回登出成功', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      (jwtService.decode as jest.Mock).mockReturnValue({ exp: nowSec + 60 });
      redisClient.set.mockRejectedValue(new Error('test command unavailable'));

      await expect(service.logout('test-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('V5：token 状态与鉴权保留 503', () => {
    it('空 token 返回 invalid，且不查询 Redis', async () => {
      await expect(service.getTokenStatus('')).resolves.toEqual({ valid: false, reason: 'invalid' });
      expect(redisClient.exists).not.toHaveBeenCalled();
    });

    it('JWT 无效返回 expired，且不查询 Redis', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('test jwt invalid'));

      await expect(service.getTokenStatus('test-token')).resolves.toEqual({
        valid: false,
        reason: 'expired',
      });
      expect(redisClient.exists).not.toHaveBeenCalled();
    });

    it('已吊销 token 返回 valid:false / blacklisted', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 1 });
      redisClient.exists.mockResolvedValue(1);

      await expect(service.getTokenStatus('test-token')).resolves.toEqual({
        valid: false,
        reason: 'blacklisted',
      });
    });

    it('有效 token 返回 valid:true', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 1 });
      redisClient.exists.mockResolvedValue(0);

      await expect(service.getTokenStatus('test-token')).resolves.toEqual({ valid: true });
    });

    it('getTokenStatus 透传 Redis 503', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 1 });
      redisClient.exists.mockRejectedValue(new Error('test command unavailable'));

      await expect(service.getTokenStatus('test-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('verifyToken 不得把 Redis 503 吞成 401', async () => {
      redisClient.exists.mockRejectedValue(new Error('test command unavailable'));

      await expect(service.verifyToken('test-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('refreshToken 不得把 Redis 503 吞成 401', async () => {
      redisClient.exists.mockRejectedValue(new Error('test command unavailable'));

      await expect(service.refreshToken('test-refresh-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
