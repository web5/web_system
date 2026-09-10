import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DictService } from './dict.service';

/**
 * 字典只读接口（C 端 / 小程序消费）。
 *
 * 与另两个入口的分工：
 * - `/admin/dict/*`：管理端（需 system:dict:view / manage 权限）
 * - `/internal/dict/:code`：服务间（x-internal-key）
 * - `/dict/:code`（本控制器）：**登录即可**，只返回启用项 —— 供小程序/门户渲染
 *   业务枚举（如合同场景 chips）。刻意不 @Public：避免匿名爬取业务枚举。
 */
@ApiTags('字典（只读）')
@Controller('dict')
export class PublicDictController {
  constructor(private readonly dictService: DictService) {}

  @Get(':code')
  @ApiOperation({ summary: '按字典编码取启用项（登录即可）' })
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
