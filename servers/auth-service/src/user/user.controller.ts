import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
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
  async getProfile() {
    // 从 request 中获取用户信息（由 JwtAuthGuard 注入）
    // 实际使用时需要从 context 获取
    return { message: 'Use gateway auth to get profile' };
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
