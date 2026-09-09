import { Controller, Get, Post, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ModelPricingService, PricingInput } from './pricing.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard, RequirePermission } from '@web-system/shared';

/**
 * 模型单价管理（Phase2.4）。
 * 读写权限统一用 agents:cost:view：成本/单价属商务信息，仅 admin+ 持有（editor/viewer 无）。
 */
@ApiTags('模型单价')
@Controller('admin/model-pricing')
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
export class ModelPricingController {
  constructor(private readonly pricing: ModelPricingService) {}

  @Get()
  @RequirePermission('agents:cost:view')
  @ApiOperation({ summary: '列出全部模型单价' })
  list() {
    return this.pricing.list();
  }

  @Post()
  @RequirePermission('agents:cost:view')
  @ApiOperation({ summary: '新建/更新模型单价（按 provider+model 幂等）' })
  upsert(@Body() body: PricingInput, @Req() req: Request) {
    return this.pricing.upsert(body, (req as any).user?.username ?? null);
  }

  @Delete(':id')
  @RequirePermission('agents:cost:view')
  @ApiOperation({ summary: '删除模型单价' })
  remove(@Param('id') id: string) {
    return this.pricing.remove(id);
  }
}
