import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('用户')
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  @Get('profile')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取当前用户信息' })
  async getProfile(@Request() req: any) {
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
