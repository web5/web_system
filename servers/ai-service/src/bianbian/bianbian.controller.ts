import { Controller, Post, Get, Delete, Body, Param, Query, Res, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { BianbianService } from './bianbian.service';
import { TransformDto } from './dto/transform.dto';
import { BusinessException } from '../common/exceptions/business.exception';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';

@ApiTags('变变 AI 变身')
@Controller('bianbian')
@ApiBearerAuth()
@UseGuards(AuthGuard)
export class BianbianController {
  private readonly logger = new Logger(BianbianController.name);

  constructor(private readonly bianbianService: BianbianService) {}

  @Post('transform')
  @ApiOperation({ summary: '变变 AI 变身 - 上传拼接作品，生成 3D 角色' })
  @ApiResponse({ status: 200, description: '成功生成 3D 角色' })
  @ApiResponse({ status: 200, description: '业务错误：code 非 0' })
  async transform(@Body() dto: TransformDto) {
    this.logger.log(
      `Transform request: userId=${dto.userId || 'anonymous'}, style=${dto.style}, size=${dto.outputSize}`,
    );

    try {
      const result = await this.bianbianService.transform(dto);
      return {
        code: 0,
        message: 'success',
        data: result,
      };
    } catch (error) {
      if (error instanceof BusinessException) {
        return { code: error.code, message: error.message, data: null };
      }
      this.logger.error(`Transform failed: ${error.message}`);
      return { code: 5000, message: '变身失败，请稍后重试', data: null };
    }
  }

  @Get('quota/:userId')
  @ApiOperation({ summary: '查询用户当日剩余变身次数' })
  @ApiQuery({ name: 'roles', required: false, description: '用户角色，逗号分隔' })
  async getQuota(
    @Param('userId') userId: string,
    @Query('roles') roles?: string,
  ) {
    const roleList = roles ? roles.split(',').filter(Boolean) : [];
    const quota = await this.bianbianService.getRemainingToday(userId, roleList);
    return {
      code: 0,
      data: quota,
    };
  }

  @Get('records')
  @ApiOperation({ summary: '获取用户的变身记录列表' })
  @ApiQuery({ name: 'userId', required: true, description: '用户 ID' })
  @ApiQuery({ name: 'page', required: false, description: '页码（默认1）' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数（默认20）' })
  async getRecords(
    @Query('userId') userId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
  ) {
    const records = await this.bianbianService.getUserRecords(
      userId,
      parseInt(page || '1', 10),
      parseInt(pageSize || '20', 10),
    );
    return {
      code: 0,
      data: records,
    };
  }

  @Delete('records/:id')
  @ApiOperation({ summary: '删除一条变身记录' })
  @ApiQuery({ name: 'userId', required: true, description: '用户 ID' })
  async deleteRecord(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    await this.bianbianService.deleteRecord(id, userId);
    return {
      code: 0,
      message: '删除成功',
    };
  }

  @Public()
  @Get('materials')
  @ApiOperation({ summary: '获取公开素材列表（供 Portal/小程序使用）' })
  async getMaterials() {
    try {
      const materials = await this.bianbianService.getMaterials();
      return { code: 0, data: materials };
    } catch (err) {
      this.logger.warn(`获取素材失败，前端将使用内置 SVG 素材: ${err.message}`);
      return { code: 5001, data: null, message: '素材服务暂不可用' };
    }
  }

  // ========== 管理员接口（内部调用） ==========

  /** 供 MaaS 服务器读取的临时参考图片（内部 URL，无需鉴权） */
  @Public()
  @Get('temp-image/:filename')
  @ApiOperation({ summary: '获取临时参考图片（内部使用）' })
  async serveTempImage(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = path.basename(filename);
    const filePath = path.join(process.cwd(), 'temp-images', safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: '图片不存在或已过期' });
    }
    return res.sendFile(filePath);
  }

  // ========== 管理员接口（内部调用） ==========

  @Get('admin/stats')
  @ApiOperation({ summary: '变变数据总览（管理员）' })
  async getAdminStats() {
    const data = await this.bianbianService.getAdminStats();
    return { code: 0, data };
  }

  @Get('admin/records')
  @ApiOperation({ summary: '变身记录列表（管理员，跨用户）' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({ name: 'userId', required: false })
  async getAdminRecords(
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('userId') userId: string,
  ) {
    const data = await this.bianbianService.getAdminRecords(
      parseInt(page || '1', 10),
      parseInt(pageSize || '20', 10),
      userId,
    );
    return { code: 0, data };
  }
}
