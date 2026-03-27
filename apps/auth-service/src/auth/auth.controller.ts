import { Controller, Post, Body, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginRequest, WechatLoginRequest, LoginResponse } from '@web-system/types';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: '用户名密码登录' })
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginRequest): Promise<LoginResponse> {
    return this.authService.login(loginDto);
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  @HttpCode(HttpStatus.OK)
  async register(@Body() registerDto: { username: string; password: string; email?: string }): Promise<LoginResponse> {
    return this.authService.register(registerDto);
  }

  @Post('wechat-login')
  @ApiOperation({ summary: '微信扫码登录' })
  @HttpCode(HttpStatus.OK)
  async wechatLogin(@Body() wechatDto: WechatLoginRequest): Promise<LoginResponse> {
    return this.authService.wechatLogin(wechatDto);
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
}
