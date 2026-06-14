import { Controller, Post, Get, Delete, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { BianbianService } from './bianbian.service';
import { TransformDto } from './dto/transform.dto';

@ApiTags('变变 AI 变身')
@Controller('bianbian')
@ApiBearerAuth()
export class BianbianController {
  private readonly logger = new Logger(BianbianController.name);

  constructor(private readonly bianbianService: BianbianService) {}

  @Post('transform')
  @ApiOperation({ summary: '变变 AI 变身 - 上传拼接作品，生成 3D 角色' })
  @ApiResponse({ status: 200, description: '成功生成 3D 角色' })
  @ApiResponse({ status: 400, description: '参数错误或次数用完' })
  async transform(@Body() dto: TransformDto) {
    this.logger.log(
      `Transform request: userId=${dto.userId || 'anonymous'}, style=${dto.style}, size=${dto.outputSize}`,
    );

    const result = await this.bianbianService.transform(dto);

    return {
      code: 0,
      message: 'success',
      data: result,
    };
  }

  @Get('quota/:userId')
  @ApiOperation({ summary: '查询用户当日剩余变身次数' })
  async getQuota(@Param('userId') userId: string) {
    const quota = await this.bianbianService.getRemainingToday(userId);
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

  @Get('materials')
  @ApiOperation({ summary: '获取公开素材列表（供 Portal/小程序使用）' })
  getMaterials() {
    // 与小程序 bianbian-constants.ts 保持一致的默认素材
    const materials = [
      // 贴纸
      { id: 's1', category: 'sticker', name: '笑脸', icon: '😊' },
      { id: 's2', category: 'sticker', name: '小猫', icon: '🐱' },
      { id: 's3', category: 'sticker', name: '小狗', icon: '🐶' },
      { id: 's4', category: 'sticker', name: '兔子', icon: '🐰' },
      { id: 's5', category: 'sticker', name: '小熊', icon: '🐻' },
      { id: 's6', category: 'sticker', name: '熊猫', icon: '🐼' },
      { id: 's7', category: 'sticker', name: '星星', icon: '⭐' },
      { id: 's8', category: 'sticker', name: '彩虹', icon: '🌈' },
      { id: 's9', category: 'sticker', name: '月亮', icon: '🌙' },
      { id: 's10', category: 'sticker', name: '太阳', icon: '☀️' },
      { id: 's11', category: 'sticker', name: '云朵', icon: '☁️' },
      { id: 's12', category: 'sticker', name: '花花', icon: '🌸' },
      // 形状
      { id: 'sh1', category: 'shape', name: '爱心', icon: '❤️' },
      { id: 'sh2', category: 'shape', name: '圆形', icon: '🟠' },
      { id: 'sh3', category: 'shape', name: '钻石', icon: '💎' },
      { id: 'sh4', category: 'shape', name: '三角', icon: '🔺' },
      // 背景
      { id: 'bg1', category: 'background', name: '草地', icon: '🟢' },
      { id: 'bg2', category: 'background', name: '天空', icon: '🔵' },
      { id: 'bg3', category: 'background', name: '粉色', icon: '🩷' },
    ];
    return { code: 0, data: materials };
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
