import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { HookService } from './hook.service';
import { CurrentUser } from '../common/decorators';

/**
 * 发布脚本 Hook 管理（仅控制台，不暴露 MCP）。
 * 开发者可自行编辑每个模块每个阶段的发布 shell 脚本。
 */
@ApiTags('发布脚本 Hook')
@ApiBearerAuth()
@Controller('modules')
export class HookController {
  constructor(private readonly hookService: HookService) {}

  @Get(':key/hooks')
  @ApiOperation({ summary: '某模块各阶段 Hook 状态（含未配置项）' })
  async listHooks(@Param('key') key: string) {
    return this.hookService.list(key);
  }

  /** 放在 :stage 之前，避免被路由吞掉 */
  @Get('hooks/templates')
  @ApiOperation({ summary: '按模块类型返回默认脚本模板' })
  async templates(@Query('type') type: string) {
    return this.hookService.templates(type || 'frontend');
  }

  @Get(':key/hooks/:stage')
  @ApiOperation({ summary: '某模块某阶段脚本（未配置返回 null）' })
  async getHook(@Param('key') key: string, @Param('stage') stage: string) {
    const h = await this.hookService.get(key, stage);
    return h;
  }

  @Put(':key/hooks/:stage')
  @ApiOperation({ summary: '保存脚本（保存前 bash -n 语法校验）' })
  async saveHook(
    @Param('key') key: string,
    @Param('stage') stage: string,
    @Body() body: { script: string },
    @CurrentUser() user: any,
  ) {
    if (!body || typeof body.script !== 'string') {
      throw new BadRequestException('缺少 script 字段');
    }
    return this.hookService.save(key, stage, body.script, user?.username);
  }

  @Delete(':key/hooks/:stage')
  @ApiOperation({ summary: '删除脚本（恢复内置逻辑）' })
  async removeHook(@Param('key') key: string, @Param('stage') stage: string) {
    return this.hookService.remove(key, stage);
  }

  @Post(':key/hooks/:stage/validate')
  @ApiOperation({ summary: '仅语法校验（不保存）' })
  validateHook(@Body() body: { script: string }) {
    if (!body || typeof body.script !== 'string') {
      throw new BadRequestException('缺少 script 字段');
    }
    this.hookService.validateScript(body.script);
    return { ok: true, message: '语法正确' };
  }
}
