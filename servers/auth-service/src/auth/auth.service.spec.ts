import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userService: jest.Mocked<Partial<UserService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

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
  };

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
    };

    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
    };

    configService = {
      get: jest.fn() as any,
    };
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
});
