import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ModelPricingService } from './pricing.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';

/**
 * 模型单价（**只读过渡，已弃用**）。
 *
 * 单价真相源已迁到字典 `llm_models` 的价格字段（2026-09-11，见
 * `specs/llm-models-unify/design.md`）：维护在 admin「字典管理」（字段定义走独立页面、
 * 记录走抽屉），ai-service 侧由 `ModelPricingCatalog` 读取。
 *
 * 本接口只保留 `GET`：迁移期对账用（`model_pricing` 表留痕不删），**写操作已下线**
 * —— 在旧接口上改价不会再影响成本核算，避免出现"改了旧表却不生效"的困惑。
 * 等确认稳定后随该表一并移除。
 */
@ApiTags('模型单价（已弃用）')
@Controller('admin/model-pricing')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
export class ModelPricingController {
  constructor(private readonly pricing: ModelPricingService) {}

  @Get()
  @RequirePermission('agents:cost:view')
  @ApiOperation({ summary: '[已弃用] 列出旧表模型单价（迁移对账用，只读）' })
  list() {
    return this.pricing.list();
  }
}
