import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { QrcodeService } from './qrcode.service';
import { QrcodeStore } from './qrcode.store';
import { UserService } from '../user/user.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('QrcodeService', () => {
  let service: QrcodeService;
  let store: QrcodeStore;
  let userService: jest.Mocked<Partial<UserService>>;
  let jwtService: jest.Mocked<Partial<JwtService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  const mockUser = {
    id: 1,
    username: 'test_user',
    password: null,
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

  beforeEach(async () => {
    store = new QrcodeStore();

    userService = {
      findByMpOpenid: jest.fn(),
      createMpUser: jest.fn(),
    };

    jwtService = {
      signAsync: jest.fn(),
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
        WECHAT_OAUTH_REDIRECT_URI: 'https://example.com/api/auth/wechat/callback',
      };
      return config[key] ?? defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrcodeService,
        { provide: QrcodeStore, useValue: store },
        { provide: UserService, useValue: userService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<QrcodeService>(QrcodeService);
  });

  // ============ 创建 Ticket ============

  describe('createTicket', () => {
    it('应创建 ticket 并返回 ticketId', () => {
      const result = service.createTicket();
      expect(result.ticketId).toBeDefined();
      expect(typeof result.ticketId).toBe('string');
    });
  });

  describe('getTicket', () => {
    it('有效 ticket 应返回数据', () => {
      const { ticketId } = service.createTicket();
      const ticket = service.getTicket(ticketId);
      expect(ticket).not.toBeNull();
      expect(ticket!.status).toBe('pending');
    });

    it('不存在的 ticket 应返回 null', () => {
      const ticket = service.getTicket('nonexistent');
      expect(ticket).toBeNull();
    });
  });

  describe('checkTicket', () => {
    it('pending 状态的 ticket 应返回 pending', () => {
      const { ticketId } = service.createTicket();
      const result = service.checkTicket(ticketId);
      expect(result.status).toBe('pending');
    });

    it('已确认的 ticket 应返回 token', () => {
      const { ticketId } = service.createTicket();
      const ticket = store.get(ticketId)!;
      store.confirm(ticketId, 1, 'access_token', 'refresh_token');

      const result = service.checkTicket(ticketId);
      expect(result.status).toBe('confirmed');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
    });

    it('不存在的 ticket 应返回 expired', () => {
      const result = service.checkTicket('nonexistent');
      expect(result.status).toBe('expired');
    });
  });

  // ============ 扫码确认（核心改动）============

  describe('confirmScan', () => {
    const jscode2sessionResponse = {
      data: {
        openid: 'mp_scan_openid_789',
        session_key: 'mock_key',
      },
    };

    beforeEach(() => {
      (jwtService.signAsync as jest.Mock)
        .mockResolvedValueOnce('scan_access_token')
        .mockResolvedValueOnce('scan_refresh_token');
    });

    it('新用户扫码应创建独立的小程序用户', async () => {
      const { ticketId } = service.createTicket();
      mockedAxios.get.mockResolvedValue(jscode2sessionResponse);
      userService.findByMpOpenid.mockResolvedValue(null);
      userService.createMpUser.mockResolvedValue({
        ...mockUser,
        mpOpenid: 'mp_scan_openid_789',
      });

      const result = await service.confirmScan(ticketId, 'wx_login_code');

      expect(result.success).toBe(true);
      expect(userService.createMpUser).toHaveBeenCalledWith(
        expect.objectContaining({ mpOpenid: 'mp_scan_openid_789' }),
      );
      // 验证没有做合并
      expect(userService.findByMpOpenid).toHaveBeenCalledWith('mp_scan_openid_789');
    });

    it('已有用户扫码应直接登录不创建', async () => {
      const { ticketId } = service.createTicket();
      mockedAxios.get.mockResolvedValue(jscode2sessionResponse);
      userService.findByMpOpenid.mockResolvedValue({
        ...mockUser,
        mpOpenid: 'mp_scan_openid_789',
        id: 5,
      });

      const result = await service.confirmScan(ticketId, 'wx_login_code');

      expect(result.success).toBe(true);
      expect(userService.createMpUser).not.toHaveBeenCalled();
    });

    it('无效的 ticket 应抛出 BadRequestException', async () => {
      await expect(
        service.confirmScan('invalid_ticket', 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('已过期的 ticket 应抛出 BadRequestException', async () => {
      const { ticketId } = service.createTicket();
      // 模拟 ticket 已确认
      store.confirm(ticketId, 1, 'token', 'refresh');

      await expect(
        service.confirmScan(ticketId, 'code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('微信接口返回错误时应抛出 BadRequestException', async () => {
      const { ticketId } = service.createTicket();
      mockedAxios.get.mockResolvedValue({
        data: { errcode: 40029, errmsg: 'invalid code' },
      });

      await expect(
        service.confirmScan(ticketId, 'bad_code'),
      ).rejects.toThrow(BadRequestException);
    });

    it('被禁用的用户应抛出 BadRequestException', async () => {
      const { ticketId } = service.createTicket();
      mockedAxios.get.mockResolvedValue(jscode2sessionResponse);
      userService.findByMpOpenid.mockResolvedValue({
        ...mockUser,
        mpOpenid: 'mp_scan_openid_789',
        status: 'banned',
      });

      await expect(
        service.confirmScan(ticketId, 'code'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============ OAuth Ticket 确认 ============

  describe('confirmOAuthTicket', () => {
    it('有效 ticket 应确认成功', async () => {
      const { ticketId } = service.createTicket();

      const result = await service.confirmOAuthTicket(ticketId, 1, 'token', 'refresh');

      expect(result.success).toBe(true);
    });

    it('已确认的 ticket 应返回 false', async () => {
      const { ticketId } = service.createTicket();
      store.confirm(ticketId, 1, 'token', 'refresh');

      const result = await service.confirmOAuthTicket(ticketId, 1, 'new_token', 'new_refresh');
      expect(result.success).toBe(false);
    });
  });

  // ============ OAuth URL 构建 ============

  describe('buildScanOAuthUrl', () => {
    it('应生成包含 ticket 的 OAuth URL', () => {
      const url = service.buildScanOAuthUrl('test_ticket_123', 'https://frontend.com/login');

      expect(url).toContain('open.weixin.qq.com/connect/oauth2/authorize');
      expect(url).toContain('appid=oa_appid');
      // state 中包含了 mini_scan_ticket（被双重编码）
      expect(url).toContain('mini_scan_ticket');
      expect(url).toContain('test_ticket_123');
      expect(url).toContain('#wechat_redirect');
    });
  });
});
