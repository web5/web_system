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

    const wechatAppId = this.configService.get('WECHAT_APPID', '');
    let openid: string;

    // 2. 用 code 换取 openid
    const secret = this.configService.get('WECHAT_SECRET', '');
    try {
      const resp = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: wechatAppId,
          secret,
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

    // 3. 查找或创建用户
    let user = await this.userService.findByWechatOpenid(openid);
    if (!user) {
      user = await this.userService.createWechatUser({
        openid,
        nickname: `wx_${openid.substring(0, 10)}`,
        avatar: '',
      });
    }
    if (user.status !== 'active') {
      throw new BadRequestException('账号已被禁用');
    }

    // 5. 生成 JWT
    const payload = {
      sub: user.id,
      username: user.username,
      roles: user.roles || ['user'],
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: '30d' });

    // 6. 标记 ticket 为已确认
    this.store.confirm(ticketId, user.id, accessToken, refreshToken);

    this.logger.log(`QR code scan confirmed: ticket=${ticketId}, user=${user.id}`);

    return { success: true };
  }
}
