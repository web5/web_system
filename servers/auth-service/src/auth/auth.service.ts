import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { UserService } from '../user/user.service';
import {
  LoginRequest,
  WechatLoginRequest,
  MiniprogramLoginRequest,
  LoginResponse,
  MiniprogramLoginResponse,
} from '@web-system/types';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * 用户名密码登录
   */
  async login(loginDto: LoginRequest): Promise<LoginResponse> {
    const user = await this.userService.findByUsername(loginDto.username);

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('账号已被禁用');
    }

    return this.generateToken(user);
  }

  /**
   * 用户注册
   */
  async register(registerDto: { username: string; password: string; email?: string }): Promise<LoginResponse> {
    const user = await this.userService.create(registerDto);
    return this.generateToken(user);
  }

  /**
   * 微信扫码登录（公众号/网站应用 OAuth2 流程）
   */
  async wechatLogin(wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    try {
      const wechatConfig = this.getWechatConfig();

      // 1. 使用 code 换取 access_token
      const tokenResponse = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: wechatConfig.appId,
          secret: wechatConfig.secret,
          code: wechatDto.code,
          grant_type: 'authorization_code',
        },
      });

      const { access_token, openid } = tokenResponse.data;

      // 2. 获取微信用户信息
      const userInfoResponse = await axios.get('https://api.weixin.qq.com/sns/userinfo', {
        params: { access_token, openid },
      });

      const wechatUser = userInfoResponse.data;

      // 3. 查找或创建本地用户
      let user = await this.userService.findByWechatOpenid(openid);

      if (!user) {
        user = await this.userService.createWechatUser({
          openid,
          nickname: wechatUser.nickname,
          avatar: wechatUser.headimgurl,
        });
      }

      return this.generateToken(user);
    } catch (error) {
      throw new BadRequestException('微信登录失败：' + error.message);
    }
  }

  /**
   * 微信小程序登录（code2Session 流程）
   */
  async miniprogramLogin(mpDto: MiniprogramLoginRequest): Promise<MiniprogramLoginResponse> {
    try {
      const wechatConfig = this.getWechatConfig();

      // 1. 调用 jscode2session 换取 openid 和 session_key
      const sessionResponse = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: wechatConfig.appId,
          secret: wechatConfig.secret,
          js_code: mpDto.code,
          grant_type: 'authorization_code',
        },
      });

      const sessionData = sessionResponse.data;

      if (sessionData.errcode) {
        throw new BadRequestException(`微信登录失败：${sessionData.errmsg}`);
      }

      const { openid, session_key, unionid } = sessionData;

      // 2. 查找或创建本地用户
      let user = await this.userService.findByWechatOpenid(openid);
      let isNewUser = false;

      if (!user) {
        user = await this.userService.createWechatUser({
          openid,
          unionid,
          nickname: mpDto.nickname || `wx_${openid.substring(0, 10)}`,
          avatar: mpDto.avatar || '',
        });
        isNewUser = true;
      } else {
        // 已有用户，更新昵称和头像
        if (mpDto.nickname || mpDto.avatar) {
          const updateData: any = {};
          if (mpDto.nickname) updateData.nickname = mpDto.nickname;
          if (mpDto.avatar) updateData.avatar = mpDto.avatar;
          // 注意：这里不直接更新 entity，需要走 service，但做简单更新
          user = await this.userService.update(user.id, {
            avatar: mpDto.avatar || user.avatar,
          });
        }
      }

      // 3. 生成 token（JWT payload 中可附带 session_key 用于解密敏感数据）
      const loginResponse = await this.generateToken(user);

      return { ...loginResponse, isNewUser };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('小程序登录失败：' + error.message);
    }
  }

  /**
   * 刷新 Token
   */
  async refreshToken(refreshToken: string): Promise<LoginResponse> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken);
      const user = await this.userService.findById(payload.sub);

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('用户不存在或已被禁用');
      }

      return this.generateToken(user);
    } catch (error) {
      throw new UnauthorizedException('Refresh token 无效');
    }
  }

  /**
   * 登出 (简单实现，不使用 Redis 黑名单)
   */
  async logout(token: string): Promise<void> {
    // TODO: 使用 Redis 时可以实现 token 黑名单
    console.log('Logout token:', token);
  }

  /**
   * 验证 token 是否在黑名单中 (暂未实现)
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    return false;
  }

  /**
   * 生成 Token
   */
  private async generateToken(user: any): Promise<LoginResponse> {
    const payload = {
      sub: user.id,
      username: user.username,
      roles: user.roles || ['user'],
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, { expiresIn: '30d' });

    const expiresInStr = this.configService.get('JWT_EXPIRES_IN', '7d');
    const expiresIn = this.parseExpiresIn(expiresInStr);

    return {
      accessToken,
      refreshToken,
      expiresIn,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        roles: user.roles || ['user'],
      },
    };
  }

  /**
   * 解析过期时间为秒数
   */
  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 7 * 24 * 60 * 60; // 默认 7 天
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 7 * 24 * 60 * 60;
    }
  }

  /**
   * 获取微信配置
   */
  private getWechatConfig() {
    return {
      appId: this.configService.get('WECHAT_APPID', ''),
      secret: this.configService.get('WECHAT_SECRET', ''),
    };
  }
}
