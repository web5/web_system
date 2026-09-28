import { Controller, Get, Query, BadRequestException, Logger, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { IndexHtmlService } from './index-html.service';

/**
 * 版本查询端点（公开）：
 * 微前端基座 / 外部系统通过 GET /__version__?module=<key>
 * 获取「当前环境某模块」的线上版本与资源加载信息，
 * 按返回的 assetBase 远程加载对应版本目录的 JS。
 *
 * `__manifest__` / `__version__` 都只做透传：组装逻辑统一在 `IndexHtmlService`，
 * 保证「注入 shell 的 HTML」与「接口返回」是同一份数据（双域重构 P3）。
 *
 * ⚠️ 2026-09-28 停用 legacy：本控制器**不再直接查** `deploy_deployments`
 * （前端版本唯一来源是 `deploy_app_env_versions`），避免与 manifest 两套口径。
 */
@ApiTags('版本')
@Controller()
export class VersionController {
  private readonly logger = new Logger(VersionController.name);

  constructor(private readonly indexHtmlService: IndexHtmlService) {}

  @Public()
  @Get('__version__')
  @ApiOperation({ summary: '查询模块当前线上版本（微前端远程加载入口）' })
  async version(@Query('module') moduleKey: string, @Req() req: Request) {
    if (!moduleKey) throw new BadRequestException('缺少 module 参数');
    // 读取源统一在 IndexHtmlService（NEW 域 deploy_app_env_versions；
    // 仅 DEPLOY_LEGACY_READ=1 时回落旧表），避免端点与 manifest 两套口径。
    return this.indexHtmlService.resolveModuleVersion(moduleKey, req);
  }

  /**
   * 模块清单（基座 / CI 用）。
   *
   * 双域重构 P3：按 Host 匹配站点返回 `envs` + `byEnv`（每个环境加载哪个固定入口），
   * 兼容字段 `env` / `modules` / `canary` 与 `byEnv` **同源**（都由 NEW 域合成），
   * 供未升级客户端回落（FR-10.1 兼容期）。
   * 未匹配站点（localhost / IP 直连）→ 退化为 `DEPLOY_ENV_ID` 单环境（`source: new:nosite`）。
   *
   * 组装在 `IndexHtmlService.buildManifest`（与注入 shell 的 HTML 同源）。
   */
  @Public()
  @Get('__manifest__')
  @ApiOperation({ summary: '查询当前站点/环境的完整模块清单（基座调试/CI 用）' })
  async manifest(@Req() req: Request): Promise<any> {
    return this.indexHtmlService.buildManifest(req);
  }
}
