import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { QrcodeStore } from './qrcode.store';
import { UserService } from '../user/user.service';

@Injectable()
export class QrcodeService {
  private readonly logger = new Logger(QrcodeService.name);

  constructor(
    private store: QrcodeStore,
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /** 创建扫码 ticket，返回给前端生成二维码 */
  createTicket(): { ticketId: string } {
    const ticket = this.store.create();
    this.logger.log(`QR code ticket created: ${ticket.ticketId}`);
    return { ticketId: ticket.ticketId };
  }

  /** 获取 ticket 原始数据（用于扫描端点验证） */
  getTicket(ticketId: string) {
    return this.store.get(ticketId) || null;
  }

  /** 轮询检查 ticket 状态 */
  checkTicket(ticketId: string) {
    const ticket = this.store.get(ticketId);
    if (!ticket) {
      return { status: 'expired' as const };
    }
    if (ticket.status === 'confirmed') {
      return {
        status: 'confirmed' as const,
        accessToken: ticket.accessToken,
        refreshToken: ticket.refreshToken,
        userId: ticket.userId,
      };
    }
    return { status: ticket.status };
  }

  /**
   * 构建扫码跳转 OAuth 的 URL
   *
   * 用户用微信扫二维码后，会被定向到这个 URL，
   * 该 URL 引导用户进入公众号 OAuth 授权页，
   * 授权完成后回调中会提取 ticketId 确认登录。
   *
   * 注：个人开放平台无法创建网站应用，所以扫码后走公众号 OAuth 流程。
   * 用户微信扫 PC 端二维码 → 打开公众号授权页 → 授权后回调 → 确认 ticket
   */
  buildScanOAuthUrl(ticketId: string, frontendRedirect: string): string {
    const config = this.getOaConfig();
    const oauthRedirectUri = this.configService.get(
      'WECHAT_OAUTH_REDIRECT_URI',
      'http://localhost:3001/auth/wechat/callback',
    );
    // 将 ticketId 编码到 state 中，回调时能解析出来
    const state = `${frontendRedirect}?mini_scan_ticket=${ticketId}`;
    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: oauthRedirectUri,
      response_type: 'code',
      scope: 'snsapi_userinfo',
      state: encodeURIComponent(state),
    });
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
  }

  /** 获取公众号配置（扫码 OAuth 使用） */
  private getOaConfig() {
    return {
      appId: this.configService.get('OFFICIAL_ACCOUNT_APP_ID', ''),
      secret: this.configService.get('OFFICIAL_ACCOUNT_SECRET', ''),
    };
  }

  /** 获取小程序配置（扫码确认使用） */
  private getMpConfig() {
    return {
      appId: this.configService.get('MINI_PROGRAM_APP_ID', ''),
      secret: this.configService.get('MINI_PROGRAM_SECRET', ''),
    };
  }

  /**
   * 小程序扫码确认
   * @param ticketId 二维码中的 ticket
   * @param code 小程序 wx.login() 获取的 code
   */
  async confirmScan(ticketId: string, code: string) {
    // 1. 验证 ticket
    const ticket = this.store.get(ticketId);
    if (!ticket || ticket.status !== 'pending') {
      throw new BadRequestException('二维码已过期或无效');
    }

    const mpConfig = this.getMpConfig();

    // 2. 用 code 换取 openid（使用小程序 AppID）
    let openid: string;
    try {
      const resp = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: mpConfig.appId,
          secret: mpConfig.secret,
          js_code: code,
          grant_type: 'authorization_code',
        },
      });
      if (resp.data.errcode) {
        throw new Error(resp.data.errmsg);
      }
      openid = resp.data.openid;
    } catch (err) {
      this.logger.error('jscode2session failed', err.message);
      throw new BadRequestException('微信登录验证失败');
    }

    // 3. 按 mpOpenid 查找已有用户，没有则创建
    let user = await this.userService.findByMpOpenid(openid);
    if (!user) {
      user = await this.userService.createMpUser({
        mpOpenid: openid,
        nickname: `wx_${openid.substring(0, 10)}`,
        avatar: '',
      });
    }

    if (user.status !== 'active') {
      throw new BadRequestException('账号已被禁用');
    }

    // 4. 生成 JWT
    const payload = {
      sub: user.id,
      username: user.username,
      roles: user.roles || ['user'],
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: '30d' });

    // 5. 标记 ticket 为已确认
    this.store.confirm(ticketId, user.id, accessToken, refreshToken);

    this.logger.log(`QR code scan confirmed: ticket=${ticketId}, user=${user.id}`);

    return { success: true };
  }

  /**
   * 微信 OAuth 扫码确认 —— 用于微信原生扫码器扫描 QR 码后的 OAuth 登录
   * 用户通过 WeChat OAuth 授权后，用此方法确认 ticket，
   * 让 PC 端轮询时能获取到 token
   */
  async confirmOAuthTicket(
    ticketId: string,
    userId: number,
    accessToken: string,
    refreshToken: string,
  ): Promise<{ success: boolean }> {
    const ticket = this.store.get(ticketId);
    if (!ticket || ticket.status !== 'pending') {
      this.logger.warn(`OAuth confirm skipped: ticket=${ticketId} not found or not pending`);
      return { success: false };
    }

    const confirmed = this.store.confirm(ticketId, userId, accessToken, refreshToken);
    if (confirmed) {
      this.logger.log(`QR code ticket confirmed via OAuth: ticket=${ticketId}, user=${userId}`);
    }
    return { success: confirmed };
  }
}
