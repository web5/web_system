import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import axios from 'axios';
import { UserService } from '../user/user.service';
import { User } from '../user/user.entity';
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

    const isPasswordValid = user.password && loginDto.password
      ? await bcrypt.compare(loginDto.password, user.password)
      : false;
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
   * 公众号 OAuth 登录（网站扫码 + 公众号内一键授权）
   */
  async wechatLogin(wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    try {
      const oaConfig = this.getOaConfig();

      // 1. 使用 code 换取 access_token
      const tokenResponse = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: oaConfig.appId,
          secret: oaConfig.secret,
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

      // 3. 按 oaOpenid 查找已有用户，没有则创建
      let user = await this.userService.findByOaOpenid(openid);
      if (!user) {
        user = await this.userService.createOaUser({
          oaOpenid: openid,
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
   *
   * 使用小程序独立的 AppID，与公众号 AppID 分开。
   * 小程序和公众号无法通过 UnionID 合并（个人开放平台未认证），
   * 各自独立创建/查找用户。用户可在个人中心手动绑定。
   */
  async miniprogramLogin(mpDto: MiniprogramLoginRequest): Promise<MiniprogramLoginResponse> {
    try {
      const mpConfig = this.getMpConfig();

      // 1. 调用 jscode2session 换取 openid
      const sessionResponse = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: {
          appid: mpConfig.appId,
          secret: mpConfig.secret,
          js_code: mpDto.code,
          grant_type: 'authorization_code',
        },
      });

      const sessionData = sessionResponse.data;

      if (sessionData.errcode) {
        throw new BadRequestException(`微信登录失败：${sessionData.errmsg}`);
      }

      const { openid } = sessionData;

      // 2. 按 mpOpenid 查找已有用户，没有则创建
      let user = await this.userService.findByMpOpenid(openid);
      let isNewUser = false;

      if (!user) {
        user = await this.userService.createMpUser({
          mpOpenid: openid,
          nickname: mpDto.nickname || `wx_${openid.substring(0, 10)}`,
          avatar: mpDto.avatar || '',
        });
        isNewUser = true;
      }

      // 3. 生成 token
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
   * 验证 Token 并返回用户信息
   * 供其他微服务调用以验证 JWT 令牌
   */
  async verifyToken(token: string): Promise<{ id: number; username: string; email?: string; avatar?: string; nickname?: string; phone?: string; gender?: 'male' | 'female' | 'unknown'; roles: string[] }> {
    try {
      const payload = await this.jwtService.verifyAsync(token);
      const user = await this.userService.findById(payload.sub);

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('用户不存在或已被禁用');
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        nickname: user.nickname,
        phone: user.phone,
        gender: user.gender,
        roles: user.roles || ['user'],
      };
    } catch (error) {
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }

  /**
   * 登出（暂为 noop，后续接入 Redis 黑名单）
   */
  async logout(token: string): Promise<void> {
    // TODO: 使用 Redis 时实现 token 黑名单
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
  private async generateToken(user: User): Promise<LoginResponse> {
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
        nickname: user.nickname,
        phone: user.phone,
        gender: user.gender,
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

  /** 获取小程序配置 */
  private getMpConfig() {
    return {
      appId: this.configService.get('MINI_PROGRAM_APP_ID', ''),
      secret: this.configService.get('MINI_PROGRAM_SECRET', ''),
    };
  }

  /** 获取公众号配置 */
  private getOaConfig() {
    return {
      appId: this.configService.get('OFFICIAL_ACCOUNT_APP_ID', ''),
      secret: this.configService.get('OFFICIAL_ACCOUNT_SECRET', ''),
    };
  }

  /**
   * 构建微信 OAuth 授权 URL
   *
   * 根据请求来源自动选择授权方式：
   * - 微信内置浏览器 → 公众号 OAuth（静默 snsapi_userinfo）
   * - 桌面浏览器 → 公众号 OAuth 跳转（微信扫码后自动打开）
   *
   * 注：个人开放平台无法创建网站应用，所以统一使用公众号 OAuth 流程。
   * 桌面浏览器扫码时，微信会先在公众号内完成 OAuth，再回调。
   *
   * @param frontendRedirect 前端回调地址（可选，作为 state 传回）
   */
  buildWechatOAuthUrl(frontendRedirect?: string): string {
    const config = this.getOaConfig();
    const redirectUri = this.configService.get(
      'WECHAT_OAUTH_REDIRECT_URI',
      'http://localhost:3001/auth/wechat/callback',
    );
    const state = frontendRedirect
      ? encodeURIComponent(frontendRedirect)
      : '';

    // 公众号 OAuth 授权 URL
    // scope: snsapi_userinfo → 获取用户昵称头像（需用户手动同意）
    // scope: snsapi_base    → 静默授权（仅获取 openid，无需用户同意）
    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_userinfo',
      state,
    });

    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
  }

  /**
   * 处理微信 OAuth 回调 —— 用 code 换 token + 用户信息
   */
  async handleWechatOAuthCallback(
    code: string,
    state: string,
  ): Promise<LoginResponse> {
    return this.wechatLogin({ code });
  }

  /**
   * 绑定小程序 openid 到已有用户（个人中心 → 设置 → 绑定微信）
   *
   * 流程：前端 wx.login() 获取 code → 传 code 到后端 → 后端 jscode2session 获取 openid → 绑定到当前用户
   */
  async bindMpOpenid(userId: number, code: string): Promise<void> {
    const mpConfig = this.getMpConfig();
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
        throw new BadRequestException(`获取 openid 失败：${resp.data.errmsg}`);
      }
      await this.userService.bindMpOpenid(userId, resp.data.openid);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('绑定小程序失败：' + error.message);
    }
  }

  /**
   * 绑定公众号 openid 到已有用户（个人中心 → 设置 → 绑定微信）
   *
   * 流程：前端跳转公众号 OAuth 授权 → 回调到后端 → 后端用 code 获取 openid → 绑定到当前用户
   */
  async bindOaOpenid(userId: number, code: string): Promise<void> {
    const oaConfig = this.getOaConfig();
    try {
      const resp = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: oaConfig.appId,
          secret: oaConfig.secret,
          code,
          grant_type: 'authorization_code',
        },
      });
      if (resp.data.errcode) {
        throw new BadRequestException(`获取 openid 失败：${resp.data.errmsg}`);
      }
      await this.userService.bindOaOpenid(userId, resp.data.openid);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('绑定公众号失败：' + error.message);
    }
  }
}
