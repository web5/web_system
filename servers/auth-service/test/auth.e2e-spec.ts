import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { QrcodeService } from '../src/qrcode/qrcode.service';
import { QrcodeStore } from '../src/qrcode/qrcode.store';
import { UserService } from '../src/user/user.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let authService: jest.Mocked<Partial<AuthService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;

  const validToken = 'valid.jwt.token';
  const mockUserPayload = { sub: 1, username: 'test_user', roles: ['user'] };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      register: jest.fn(),
      wechatLogin: jest.fn(),
      miniprogramLogin: jest.fn(),
      refreshToken: jest.fn(),
      verifyToken: jest.fn(),
      logout: jest.fn(),
      buildWechatOAuthUrl: jest.fn(),
      handleWechatOAuthCallback: jest.fn(),
      bindMpOpenid: jest.fn(),
      bindOaOpenid: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn(),
      verify: jest.fn(),
      verifyAsync: jest.fn(),
      sign: jest.fn(),
      decode: jest.fn(),
      options: {} as any,
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: QrcodeService, useValue: {} },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // ============ 登录/注册端点 ============

  describe('POST /auth/login', () => {
    it('登录成功应返回 token', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresIn: 604800,
        user: { id: 1, username: 'test', roles: ['user'] },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: 'test', password: '123456' })
        .expect(200);

      expect(res.body.accessToken).toBe('token');
    });
  });

  describe('POST /auth/register', () => {
    it('注册成功应返回 token', async () => {
      authService.register.mockResolvedValue({
        accessToken: 'new_token',
        refreshToken: 'new_refresh',
        expiresIn: 604800,
        user: { id: 2, username: 'new_user', roles: ['user'] },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username: 'new_user', password: '123456' })
        .expect(200);

      expect(res.body.accessToken).toBe('new_token');
    });
  });

  // ============ 绑定接口端点（新增）============

  describe('POST /auth/bind-miniprogram', () => {
    it('未登录时应返回 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/bind-miniprogram')
        .send({ code: 'wx_code' })
        .expect(401);
    });

    it('登录后应成功绑定小程序', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(mockUserPayload);
      authService.bindMpOpenid.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/bind-miniprogram')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ code: 'wx_login_code' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('绑定成功');
      expect(authService.bindMpOpenid).toHaveBeenCalledWith(1, 'wx_login_code');
    });
  });

  describe('POST /auth/bind-official-account', () => {
    it('未登录时应返回 401', async () => {
      await request(app.getHttpServer())
        .post('/auth/bind-official-account')
        .send({ code: 'oauth_code' })
        .expect(401);
    });

    it('登录后应成功绑定公众号', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue(mockUserPayload);
      authService.bindOaOpenid.mockResolvedValue(undefined);

      const res = await request(app.getHttpServer())
        .post('/auth/bind-official-account')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ code: 'oauth_code_123' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(authService.bindOaOpenid).toHaveBeenCalledWith(1, 'oauth_code_123');
    });
  });

  // ============ 微信 OAuth ============

  describe('GET /auth/wechat/authorize', () => {
    it('应重定向到微信授权页', async () => {
      authService.buildWechatOAuthUrl.mockReturnValue('https://open.weixin.qq.com/connect/oauth2/authorize?appid=test');

      const res = await request(app.getHttpServer())
        .get('/auth/wechat/authorize')
        .query({ redirect: 'https://frontend.com/login' })
        .expect(302);

      expect(res.headers.location).toContain('open.weixin.qq.com');
    });
  });

  describe('POST /auth/wechat-login', () => {
    it('微信 OAuth 登录应返回 token', async () => {
      authService.wechatLogin.mockResolvedValue({
        accessToken: 'oa_token',
        refreshToken: 'oa_refresh',
        expiresIn: 604800,
        user: { id: 3, username: 'wx_user', roles: ['user'] },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/wechat-login')
        .send({ code: 'oauth_code' })
        .expect(200);

      expect(res.body.accessToken).toBe('oa_token');
    });
  });

  describe('POST /auth/miniprogram-login', () => {
    it('小程序登录应返回 token', async () => {
      authService.miniprogramLogin.mockResolvedValue({
        accessToken: 'mp_token',
        refreshToken: 'mp_refresh',
        expiresIn: 604800,
        isNewUser: true,
        user: { id: 4, username: 'wx_mp_user', roles: ['user'] },
      });

      const res = await request(app.getHttpServer())
        .post('/auth/miniprogram-login')
        .send({ code: 'mp_code', nickname: '用户', avatar: '' })
        .expect(200);

      expect(res.body.accessToken).toBe('mp_token');
      expect(res.body.isNewUser).toBe(true);
    });
  });
});
