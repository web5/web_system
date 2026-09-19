import { Controller, Get, Query, BadRequestException, Logger, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { DeployDeploymentEntity } from './deploy-deployment.entity';
import { DeployModuleEntity } from './deploy-module.entity';
import { IndexHtmlService } from './index-html.service';
import { ConfigService } from '@nestjs/config';

/**
 * 版本查询端点（公开）：
 * 微前端基座 / 外部系统通过 GET /__version__?module=<key>
 * 获取「当前环境某模块」的线上版本与资源加载信息，
 * 按返回的 assetBase 远程加载对应版本目录的 JS。
 *
 * `__manifest__` 只做透传：组装逻辑统一在 `IndexHtmlService.buildManifest`，
 * 保证「注入 shell 的 HTML」与「接口返回」是同一份数据（双域重构 P3）。
 */
@ApiTags('版本')
@Controller()
export class VersionController {
  private readonly logger = new Logger(VersionController.name);

  constructor(
    private configService: ConfigService,
    private indexHtmlService: IndexHtmlService,
    @InjectRepository(DeployDeploymentEntity, 'deploy')
    private deployRepo: Repository<DeployDeploymentEntity>,
    @InjectRepository(DeployModuleEntity, 'deploy')
    private moduleRepo: Repository<DeployModuleEntity>,
  ) {}

  @Public()
  @Get('__version__')
  @ApiOperation({ summary: '查询模块当前线上版本（微前端远程加载入口）' })
  async version(@Query('module') moduleKey: string) {
    if (!moduleKey) throw new BadRequestException('缺少 module 参数');
    const envId = this.configService.get('DEPLOY_ENV_ID') || 'dev';

    const module = await this.moduleRepo.findOne({ where: { key: moduleKey } });
    const row = await this.deployRepo.findOne({
      where: { envId, moduleKey },
      order: { deployedAt: 'DESC' },
    });
    const version = row?.currentVersion || undefined;
    const base = version ? `/static/modules/${moduleKey}/${version}/` : null;

    return {
      env: envId,
      module: moduleKey,
      name: module?.name || moduleKey,
      type: module?.type || 'unknown',
      version,
      entry: base ? `${base}index.js` : null,
      css: base ? `${base}index.css` : null,
      assetsBase: base,
    };
  }

  /**
   * 模块清单（基座 / CI 用）。
   *
   * 双域重构 P3：按 Host 匹配站点返回 `envs` + `byEnv`（每个环境加载哪个固定入口），
   * 同时保留旧字段（`env` / `modules` / `canary`）供未升级客户端回落（FR-10.1 兼容期）。
   * 未匹配站点（localhost / IP 直连）→ 只返回旧结构，行为不变。
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
