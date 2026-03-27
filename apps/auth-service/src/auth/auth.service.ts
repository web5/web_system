import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { UserService } from '../user/user.service';
import { LoginRequest, WechatLoginRequest, LoginResponse } from '@web-system/types';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
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
   * 微信扫码登录
   */
  async wechatLogin(wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    try {
      // 1. 使用 code 换取 access_token
      const tokenResponse = await axios.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: process.env.WECHAT_APPID,
          secret: process.env.WECHAT_SECRET,
          code: wechatDto.code,
          grant_type: 'authorization_code',
        },
      });

      const { access_token, openid } = tokenResponse.data;

      // 2. 获取微信用户信息
      const userInfoResponse = await axios.get('https://api.weixin.qq.com/sns/userinfo', {
        params: {
          access_token,
          openid,
        },
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

    return {
      accessToken,
      refreshToken,
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        roles: user.roles || ['user'],
      },
    };
  }
}
