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
