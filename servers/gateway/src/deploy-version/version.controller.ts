import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
 */
@ApiTags('版本')
@Controller()
export class VersionController {
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

  @Public()
  @Get('__manifest__')
  @ApiOperation({ summary: '查询当前环境完整模块清单（基座调试/CI 用）' })
  async manifest(): Promise<any> {
    // 复用 IndexHtmlService 的清单解析（不注入 HTML，直接返回 JSON）
    const envId = this.configService.get('DEPLOY_ENV_ID') || 'dev';
    return this.indexHtmlService.resolveModulesManifest(envId);
  }
}
