import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/auth.guard';
import { OperationLogClient } from '../permission/operation-log.client';
import { PermissionGuard, RequirePermission, getUploadDir, resolvePublicUrl, PublicBaseUrlService } from '@web-system/shared';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeOwnPasswordDto, ResetPasswordDto } from './dto/change-password.dto';
import type { Request } from 'express';

/**
 * 头像落盘目录 = 上传根目录 + `avatars`。
 *
 * 为什么抽成纯函数：Multer 的 `destination` 在**装饰器求值期**执行，拿不到 DI，
 * 只能读进程内持有者；抽出来后这个函数可以被单测直接钉住口径 ——
 * 否则「头像写到哪个目录」这件事没有任何自动化证据。
 *
 * 上传根目录是启动期按形态解析出的进程常量（cluster 取系统配置表 storage.upload_dir），
 * 不再用「运行根 + 段名」自己拼（那正是漂移的来源）。
 */
export function avatarUploadDir(): string {
  return path.join(getUploadDir(), 'avatars');
}

/** AuthGuard 校验通过后挂到 req.user 的最小结构（绕开 passport 的空 User 类型） */
interface AuthedRequest extends Request {
  user?: { id: number; username?: string };
}

@ApiTags('用户管理')
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly operationLogClient: OperationLogClient,
    private readonly publicBaseUrl: PublicBaseUrlService,
  ) {}

  /**
   * 头像相对路径 → 公网绝对 URL（返回前端前拼接；DB 仍存相对路径）。
   * 公网根地址主源为 system-service `system_configs` 表（key=public_base_url），
   * env `PUBLIC_BASE_URL` 降级为兜底；留空/非法时保持相对路径，与历史行为一致。
   */
  private async resolveAvatarUrl(avatar?: string | null): Promise<string> {
    const base = await this.publicBaseUrl.resolve();
    return resolvePublicUrl(avatar, base);
  }

  @Get()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:view')
  @ApiOperation({ summary: '获取用户列表' })
  async findAll(
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 10,
    @Query('keyword') keyword?: string,
    /** 按归属系统过滤：portal / admin / deploy；不传或 all = 全部 */
    @Query('system') system?: string,
  ) {
    return this.userService.findAll(page, pageSize, keyword, system);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户信息' })
  async getMe(@Req() req: AuthedRequest) {
    const user = await this.userService.findById(String(req.user?.id));
    if (!user) return { code: 0, data: user };
    // 响应脱敏（2026-11-12 P1 安全修复）：实体含 password 哈希，绝不进响应体
    const { password: _pwd, ...safeUser } = user;
    return { code: 0, data: { ...safeUser, avatar: await this.resolveAvatarUrl(user.avatar) } };
  }

  @Put('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新当前用户资料' })
  async updateMe(@Req() req: AuthedRequest, @Body() userData: UpdateUserDto) {
    // userService.update 返回值已剥 password（见 service.stripPassword）
    const user = await this.userService.update(String(req.user?.id), userData);
    return { code: 0, data: { ...user, avatar: await this.resolveAvatarUrl(user.avatar) } };
  }

  @Put('me/password')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改当前用户密码（个人中心）' })
  async changeOwnPassword(@Req() req: AuthedRequest, @Body() dto: ChangeOwnPasswordDto) {
    await this.userService.changeOwnPassword(String(req.user?.id), dto.oldPassword, dto.newPassword);
    return { code: 0, data: null, message: '密码修改成功' };
  }

  @Post('me/avatar')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = avatarUploadDir();
          if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, `avatar-${uniqueSuffix}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          return cb(new BadRequestException('仅支持 JPG/PNG/GIF/WEBP 图片格式'), false);
        }
        cb(null, true);
      },
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
      },
    }),
  )
  @ApiOperation({ summary: '上传用户头像' })
  async uploadAvatar(@Req() req: AuthedRequest, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传图片文件');
    }

    const avatarUrl = `/api/uploads/avatars/${file.filename}`;
    await this.userService.update(String(req.user?.id), { avatar: avatarUrl });

    return { code: 0, data: { avatarUrl: await this.resolveAvatarUrl(avatarUrl) } };
  }

  @Get('profile')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:view')
  @ApiOperation({ summary: '获取用户详情' })
  async profile(@Query('id') id: string) {
    if (id) {
      return this.userService.findOne(id);
    }
    return { message: '请提供用户 ID' };
  }

  @Get(':id')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:view')
  @ApiOperation({ summary: '根据 ID 获取用户' })
  async findOne(@Param('id') id: string) {
    return this.userService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:create')
  @ApiOperation({ summary: '创建用户' })
  async create(@Body() userData: CreateUserDto) {
    return this.userService.create(userData);
  }

  @Put(':id')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:edit')
  @ApiOperation({ summary: '更新用户' })
  async update(@Param('id') id: string, @Body() userData: UpdateUserDto) {
    return this.userService.update(id, userData);
  }

  @Put(':id/password')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:edit')
  @ApiOperation({ summary: '管理员重置用户密码（用户管理）' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto, @Req() req: AuthedRequest) {
    await this.userService.resetPassword(id, dto.newPassword);
    // 高敏感操作：写操作日志（失败不阻断业务，见 OperationLogClient 契约）
    void this.operationLogClient.write({
      operator: req.user?.username || String(req.user?.id ?? ''),
      type: 'user_password_reset',
      target: `user:${id}`,
      ip: req.ip,
    });
    return { code: 0, data: null, message: '密码重置成功' };
  }

  @Delete(':id')
  @UseGuards(AuthGuard, PermissionGuard)
  @RequirePermission('users:delete')
  @ApiOperation({ summary: '删除用户' })
  async remove(@Param('id') id: string) {
    await this.userService.remove(id);
    return { message: 'User deleted successfully' };
  }
}
