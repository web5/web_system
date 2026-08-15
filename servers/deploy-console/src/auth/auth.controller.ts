import { Controller, Post, Get, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from '../common/dto';

/**
 * 认证控制器
 * 处理登录和获取用户信息
 */
@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 用户登录
   * 验证凭据并返回 JWT 令牌
   */
  @Public()
  @Post('login')
  @ApiOperation({ summary: '用户登录' })
  @ApiResponse({ status: 200, description: '登录成功，返回 token' })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async login(@Body() body: LoginDto) {
    const isValid = this.authService.validateUser(body.username, body.password);
    if (!isValid) {
      return { statusCode: 401, message: '用户名或密码错误', error: 'Unauthorized' };
    }
    return this.authService.login(body.username);
  }

  /**
   * 获取当前用户信息
   * 需要 JWT 认证
   */
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  @ApiResponse({ status: 200, description: '返回用户信息' })
  getProfile(@Request() req: any) {
    return req.user;
  }
}
