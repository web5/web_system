import { Injectable, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService, DEFAULT_REDIS } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import axios from 'axios';
import { UserService } from '../user/user.service';
import type { User } from '../user/user.entity';
import type {
  LoginRequest,
  WechatLoginRequest,
  MiniprogramLoginRequest,
  LoginResponse,
  MiniprogramLoginResponse,
} from '@web-system/types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /** 便捷获取默认 Redis 客户端 */
  private get redis(): Redis {
    return this.redisService.getOrThrow(DEFAULT_REDIS);
  }

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
   * 公众号 OAuth 登录
   */
  async wechatLogin(wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    try {
      const oaConfig = this.getOaConfig();

      const tokenResponse = await axios.get(
        'https://api.weixin.qq.com/sns/oauth2/access_token',
        { params: { appid: oaConfig.appId, secret: oaConfig.secret, code: wechatDto.code, grant_type: 'authorization_code' } },
      );

      const { access_token, openid } = tokenResponse.data;

      const userInfoResponse = await axios.get(
        'https://api.weixin.qq.com/sns/userinfo',
        { params: { access_token, openid } },
      );

      const wechatUser = userInfoResponse.data;

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
   * 微信小程序登录
   */
  async miniprogramLogin(mpDto: MiniprogramLoginRequest): Promise<MiniprogramLoginResponse> {
    try {
      const mpConfig = this.getMpConfig();

      const sessionResponse = await axios.get(
        'https://api.weixin.qq.com/sns/jscode2session',
        { params: { appid: mpConfig.appId, secret: mpConfig.secret, js_code: mpDto.code, grant_type: 'authorization_code' } },
      );

      const sessionData = sessionResponse.data;
      if (sessionData.errcode) {
        throw new BadRequestException(`微信登录失败：${sessionData.errmsg}`);
      }

      const { openid } = sessionData;

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
      this.logger.warn(
        `Refresh token 验证失败: ${(error as Error)?.message || error}`,
      );
      throw new UnauthorizedException('Refresh token 无效');
    }
  }

  /**
   * 验证 Token 并返回用户信息，同时检查黑名单
   */
  async verifyToken(token: string): Promise<{
    id: number; username: string; email?: string; avatar?: string;
    nickname?: string; phone?: string; gender?: 'male' | 'female' | 'unknown';
    roles: string[];
  }> {
    try {
      // 检查是否在黑名单中
      if (await this.isTokenBlacklisted(token)) {
        throw new UnauthorizedException('令牌已失效（已登出）');
      }

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
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('令牌无效或已过期');
    }
  }

  /**
   * 登出 — 将 access token 加入 Redis 黑名单，在 token 剩余有效期内阻止复用
   */
  async logout(token: string): Promise<void> {
    try {
      const payload = this.jwtService.decode(token) as { exp?: number } | null;
      if (!payload?.exp) return;

      const ttl = payload.exp - Math.floor(Date.now() / 1000);
      if (ttl <= 0) return;

      const hash = this.hashToken(token);
      await this.redis.set(`bl:${hash}`, '1', 'EX', ttl);
      this.logger.debug(`Token 已加入黑名单，TTL=${ttl}s`);
    } catch (err: any) {
      this.logger.warn(`登出黑名单写入失败: ${err.message}`);
    }
  }

  /**
   * 检查 token 是否在黑名单中（Redis 不可用时放行）
   */
  async isTokenBlacklisted(token: string): Promise<boolean> {
    try {
      const hash = this.hashToken(token);
      const exists = await this.redis.exists(`bl:${hash}`);
      return exists === 1;
    } catch (err: any) {
      this.logger.warn(`黑名单查询失败: ${err.message}`);
      return false;
    }
  }

  /**
   * 生成 Token，access 和 refresh 通过 type 字段区分
   */
  private async generateToken(user: User): Promise<LoginResponse> {
    const basePayload = {
      sub: user.id,
      username: user.username,
      roles: user.roles || ['user'],
    };

    const accessToken = await this.jwtService.signAsync(
      { ...basePayload, type: 'access' },
    );
    const refreshToken = await this.jwtService.signAsync(
      { ...basePayload, type: 'refresh' },
      { expiresIn: '30d' },
    );

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

  /** 计算 token 的 SHA256 前 32 位作为 Redis key */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  }

  private parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)(s|m|h|d)$/);
    if (!match) return 7 * 24 * 60 * 60;
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

  private getMpConfig() {
    return {
      appId: this.configService.get('MINI_PROGRAM_APP_ID', ''),
      secret: this.configService.get('MINI_PROGRAM_SECRET', ''),
    };
  }

  private getOaConfig() {
    return {
      appId: this.configService.get('OFFICIAL_ACCOUNT_APP_ID', ''),
      secret: this.configService.get('OFFICIAL_ACCOUNT_SECRET', ''),
    };
  }

  buildWechatOAuthUrl(frontendRedirect?: string): string {
    const config = this.getOaConfig();
    const redirectUri = this.configService.get(
      'WECHAT_OAUTH_REDIRECT_URI',
      'http://localhost:6001/auth/wechat/callback',
    );
    const state = frontendRedirect ? encodeURIComponent(frontendRedirect) : '';
    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'snsapi_userinfo',
      state,
    });
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
  }

  async handleWechatOAuthCallback(code: string, _state: string): Promise<LoginResponse> {
    return this.wechatLogin({ code });
  }

  async bindMpOpenid(userId: number, code: string): Promise<void> {
    const mpConfig = this.getMpConfig();
    try {
      const resp = await axios.get('https://api.weixin.qq.com/sns/jscode2session', {
        params: { appid: mpConfig.appId, secret: mpConfig.secret, js_code: code, grant_type: 'authorization_code' },
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

  async bindOaOpenid(userId: number, code: string): Promise<void> {
    const oaConfig = this.getOaConfig();
    try {
      const resp = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: { appid: oaConfig.appId, secret: oaConfig.secret, code, grant_type: 'authorization_code' },
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
