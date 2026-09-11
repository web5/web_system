import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployPipelineStepCommandEntity } from '../entities/deploy-pipeline-step-command.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import { PLATFORM_STEP_SCRIPTS, getPlatformStepScript } from '../pipeline/step-scripts';

/**
 * 平台托管脚本同步（`locked=true` 的节点命令）。
 *
 * 设计取舍：**代码是真相源，DB 只是存放介质**
 * - 启动时全量同步 → 页面/接口都能看到当前脚本，两端（本机 / dev）随版本自动一致；
 * - 提交发布时按模板同步一次（见 `PipelineService.submit`）→ 新模板/改过库的模板也不会漏；
 * - 手工 SQL 改过脚本？下次启动/提交会被重置 —— 这正是"平台托管"的语义，也是重置手段。
 *
 * 注意：只写 `locked` 的平台脚本，用户自配的 script 节点（build/upload/…）一律不碰。
 */
@Injectable()
export class PlatformScriptSeedService implements OnModuleInit {
  private readonly logger = new Logger(PlatformScriptSeedService.name);

  constructor(
    @InjectRepository(DeployPipelineStepCommandEntity)
    private readonly repo: Repository<DeployPipelineStepCommandEntity>,
    @InjectRepository(DeployPipelineTemplateEntity)
    private readonly templates: Repository<DeployPipelineTemplateEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const changed = await this.seedAll();
      if (changed) {
        this.logger.log(`平台托管脚本已同步：git（${changed} 个模板有变更）`);
      }
    } catch (e) {
      // 种子失败不阻断启动（发布时还会再同步一次），但必须留痕
      this.logger.warn(`平台托管脚本同步失败: ${(e as Error).message}`);
    }
  }

  /** 全量模板同步；返回发生变更的模板数 */
  async seedAll(): Promise<number> {
    const tpls = await this.templates.find({ select: { id: true } });
    let changed = 0;
    for (const t of tpls) {
      if (await this.seedForTemplate(t.id)) changed++;
    }
    return changed;
  }

  /**
   * 同步单个模板的平台脚本（幂等）。
   * @returns true=有写入（内容或锁定位发生变化）
   */
  async seedForTemplate(templateId: string): Promise<boolean> {
    let wrote = false;
    for (const item of PLATFORM_STEP_SCRIPTS) {
      const script = getPlatformStepScript(item.nodeKey);
      const row = await this.repo.findOne({ where: { templateId, nodeKey: item.nodeKey } });
      if (row?.locked && row.command === script && row.enabled) continue;

      const next =
        row ?? this.repo.create({ templateId, nodeKey: item.nodeKey, command: '', enabled: true });
      next.command = script;
      next.actions = null;
      next.locked = true;
      next.enabled = true;
      next.updatedBy = 'system';
      await this.repo.save(next);
      wrote = true;
    }
    return wrote;
  }
}
