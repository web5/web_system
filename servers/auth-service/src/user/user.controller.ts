import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

/** JwtAuthGuard 注入后的请求体：req.user.userId 由 jwt strategy 的 payload.sub 写入 */
interface AuthRequest {
  user?: { userId?: number };
}

@ApiTags('用户')
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取当前用户信息' })
  async getProfile(@Request() req: AuthRequest) {
    const userId = req.user?.userId;
    if (!userId) {
      return { code: 401, message: '未登录' };
    }
    const user = await this.userService.findById(userId);
    if (!user) {
      return { code: 404, message: '用户不存在' };
    }
    const { password, ...result } = user;
    return { code: 200, data: result };
  }

  @Patch('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新当前用户信息（昵称/头像）' })
  async updateProfile(
    @Request() req: AuthRequest,
    @Body() body: { nickname?: string; avatar?: string },
  ) {
    const userId = req.user?.userId;
    if (!userId) {
      return { code: 401, message: '未登录' };
    }

    const patch: { nickname?: string; avatar?: string } = {};
    if (typeof body?.nickname === 'string') {
      const nickname = body.nickname.trim();
      if (nickname) patch.nickname = nickname.slice(0, 50);
    }
    if (typeof body?.avatar === 'string') {
      patch.avatar = body.avatar.slice(0, 500);
    }
    if (Object.keys(patch).length === 0) {
      return { code: 400, message: '无可更新的字段' };
    }

    const user = await this.userService.update(userId, patch);
    const { password, ...result } = user;
    return { code: 200, data: result };
  }

  @Get(':id')
  @ApiOperation({ summary: '根据 ID 获取用户' })
  async getUserById(@Param('id', ParseIntPipe) id: number) {
    const user = await this.userService.findById(id);
    if (!user) {
      return { code: 404, message: '用户不存在' };
    }
    // 不返回敏感信息
    const { password, ...result } = user;
    return { code: 200, data: result };
  }
}
