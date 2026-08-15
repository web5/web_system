import { Controller, Get, Put, Body, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService_ } from './config.service';
import { FileUpdateDto } from '../common/dto';
import { CurrentUser } from '../common/decorators';
import { AuditService } from '../audit/audit.service';

/**
 * 配置管理控制器
 * 提供配置文件的读取、列表和保存功能
 */
@ApiTags('配置管理')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  constructor(
    private readonly configService: ConfigService_,
    private readonly auditService: AuditService,
  ) {}

  /**
   * 列出所有可用配置文件
   */
  @Get('files')
  @ApiOperation({ summary: '获取配置文件列表' })
  @ApiResponse({ status: 200, description: '返回配置文件列表' })
  listFiles() {
    return this.configService.listFiles();
  }

  /**
   * 获取单个配置文件内容
   */
  @Get('file')
  @ApiOperation({ summary: '获取配置文件内容' })
  @ApiResponse({ status: 200, description: '返回文件内容' })
  @ApiResponse({ status: 404, description: '文件不存在' })
  getFile(@Query('env') env: string, @Query('name') name: string) {
    if (!env || !name) {
      throw new BadRequestException('缺少必要参数: env, name');
    }
    return this.configService.readFile(env, name);
  }

  /**
   * 保存配置文件
   * 同时记录审计日志
   */
  @Put('file')
  @ApiOperation({ summary: '保存配置文件' })
  @ApiResponse({ status: 200, description: '保存成功' })
  async saveFile(
    @Body() body: FileUpdateDto,
    @CurrentUser() user: any,
  ) {
    const result = this.configService.saveFile(body.env, body.name, body.content);
    // 记录审计日志
    await this.auditService.log({
      user: user?.username || 'unknown',
      action: 'config.save',
      env: body.env,
      component: body.name,
      status: 'success',
      detail: `保存配置文件: ${body.name}`,
    });
    return result;
  }

  /**
   * 获取环境简要信息
   */
  @Get('environments')
  @ApiOperation({ summary: '获取环境列表' })
  @ApiResponse({ status: 200, description: '返回环境列表' })
  getEnvironments() {
    return this.configService.getEnvironments();
  }
}
