import { Controller, Post, Get, Body, Query, Res, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  WechatLoginRequest,
  MiniprogramLoginRequest,
  LoginResponse,
  MiniprogramLoginResponse,
} from '@web-system/types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Response } from 'express';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: '用户名密码登录' })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  @HttpCode(HttpStatus.OK)
  async register(@Body() registerDto: RegisterDto): Promise<LoginResponse> {
    return this.authService.register(registerDto);
  }

  @Post('wechat-login')
  @ApiOperation({ summary: '微信扫码登录' })
  @HttpCode(HttpStatus.OK)
  async wechatLogin(@Body() wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    return this.authService.wechatLogin(wechatDto);
  }

  @Post('miniprogram-login')
  @ApiOperation({ summary: '微信小程序登录' })
  @HttpCode(HttpStatus.OK)
  async miniprogramLogin(@Body() mpDto: MiniprogramLoginRequest): Promise<MiniprogramLoginResponse> {
    return this.authService.miniprogramLogin(mpDto);
  }

  @Post('refresh')
  @ApiOperation({ summary: '刷新 Token' })
  @HttpCode(HttpStatus.OK)
  async refresh(@Body('refreshToken') refreshToken: string): Promise<LoginResponse> {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出' })
  @HttpCode(HttpStatus.OK)
  async logout(@Headers('authorization') auth: string): Promise<void> {
    const token = auth?.replace('Bearer ', '');
    if (token) {
      await this.authService.logout(token);
    }
  }

  /**
   * 微信 OAuth 授权入口 —— 重定向到微信授权页面
   * GET /auth/wechat/authorize
   *
   * 支持两种场景：
   * 1. 微信内置浏览器 → 微信公众号 OAuth（snsapi_userinfo 静默授权）
   * 2. 桌面浏览器 → 微信开放平台网站应用 QR 登录（snsapi_login）
   */
  @Get('wechat/authorize')
  @ApiOperation({ summary: '微信网页授权跳转' })
  redirectToWechat(
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    const authUrl = this.authService.buildWechatOAuthUrl(redirect);
    res.redirect(authUrl);
  }

  /**
   * 微信 OAuth 回调 —— 微信授权后带 code 回调到这里
   * GET /auth/wechat/callback?code=xxx&state=xxx
   */
  @Get('wechat/callback')
  @ApiOperation({ summary: '微信网页授权回调' })
  async wechatCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.handleWechatOAuthCallback(code, state);
      // 将 token 通过 URL 参数传回前端（生产环境建议用 cookie）
      const frontendUrl = state
        ? decodeURIComponent(state)
        : '/';
      const separator = frontendUrl.includes('?') ? '&' : '?';
      res.redirect(
        `${frontendUrl}${separator}token=${result.accessToken}&refreshToken=${result.refreshToken}`,
      );
    } catch (error) {
      res.redirect('/login?error=wechat_auth_failed');
    }
  }
}
