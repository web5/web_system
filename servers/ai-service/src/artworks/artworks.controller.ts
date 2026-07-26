import { Controller, Post, Get, Delete, Body, Query, Param, ParseIntPipe, Logger, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ArtworksService } from './artworks.service';
import { SaveArtworkDto } from './dto/save-artwork.dto';
import { BusinessException } from '../common/exceptions/business.exception';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('作品相册')
@Controller('ai/artworks')
@UseGuards(AuthGuard)
export class ArtworksController {
  private readonly logger = new Logger(ArtworksController.name);

  constructor(private readonly artworksService: ArtworksService) {}

  /** 保存作品到相册 */
  @Post()
  @ApiOperation({ summary: '保存作品到相册' })
  async save(@Body() dto: SaveArtworkDto) {
    try {
      const data = await this.artworksService.save(dto);
      return { code: 0, message: '保存成功', data };
    } catch (error) {
      if (error instanceof BusinessException) {
        return { code: error.code, message: error.message, data: null };
      }
      this.logger.error(`Save artwork failed: ${error.message}`);
      return { code: 5000, message: '保存失败，请稍后重试', data: null };
    }
  }

  /** 获取用户相册列表 */
  @Get()
  @ApiOperation({ summary: '获取用户相册作品列表' })
  async findByUser(@Query('userId', ParseIntPipe) userId: number) {
    try {
      const data = await this.artworksService.findByUser(userId);
      return { code: 0, data };
    } catch (error) {
      if (error instanceof BusinessException) {
        return { code: error.code, message: error.message, data: null };
      }
      this.logger.error(`Get artworks failed: ${error.message}`);
      return { code: 5000, message: '加载失败，请稍后重试', data: null };
    }
  }

  /** 删除相册中的作品 */
  @Delete(':id')
  @ApiOperation({ summary: '删除相册作品' })
  async delete(
    @Param('id') id: string,
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    try {
      await this.artworksService.delete(userId, id);
      return { code: 0, message: '删除成功' };
    } catch (error) {
      if (error instanceof BusinessException) {
        return { code: error.code, message: error.message, data: null };
      }
      this.logger.error(`Delete artwork failed: ${error.message}`);
      return { code: 5000, message: '删除失败，请稍后重试', data: null };
    }
  }
}
