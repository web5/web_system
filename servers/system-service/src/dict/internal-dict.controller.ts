import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DictService } from './dict.service';
import { Public } from '../auth/decorators';
import { InternalGuard } from '../auth/internal.guard';

/**
 * 字典消费接口（服务间调用）。
 *
 * 与 `/admin/dict` 的区别：只返回**启用项**、且不暴露未启用的数据；
 * 鉴权走 `x-internal-key: INTERNAL_API_KEY`（@Public 跳过全局 JWT）。
 * 消费方（如 ai-agent）必须做三级回落：DB 字典 → 环境变量 → 代码内置常量。
 */
@ApiTags('字典管理（内部）')
@Controller('internal/dict')
@Public()
@UseGuards(InternalGuard)
export class InternalDictController {
  constructor(private readonly dictService: DictService) {}

  @Get(':code')
  @ApiOperation({ summary: '按字典编码取启用项（服务间消费）' })
  async listEnabled(@Param('code') code: string) {
    const rows = await this.dictService.listEnabledItems(code);
    return {
      code: 0,
      data: rows.map((r) => ({
        value: r.value,
        label: r.label,
        attrs: r.attrs,
        sort: r.sort,
      })),
    };
  }
}
