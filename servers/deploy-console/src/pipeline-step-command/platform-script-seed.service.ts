import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployPipelineStepCommandEntity } from '../entities/deploy-pipeline-step-command.entity';
import { DeployPipelineTemplateEntity } from '../entities/deploy-pipeline-template.entity';
import {
  PLATFORM_STEP_SCRIPTS,
  DEFAULT_STEP_SCRIPTS,
  getPlatformStepScript,
  getDefaultStepScript,
} from '../pipeline/step-scripts';

/**
 * 平台托管脚本同步（`locked=true` 的节点命令）+ 默认脚本初始化。
 *
 * 设计取舍：**代码是真相源，DB 只是存放介质**（仅对 `PLATFORM_STEP_SCRIPTS` 清单内的节点）
 *
 * ⚠️ 2026-09-21：该清单已**清空** —— restart / verify 下沉为发布流水线里的 DB action
 * （脚本正文归运维，可用 `CONSOLE_API` / `CONSOLE_TOKEN` 调 `/api/internal/release/*`）。
 * 见 `specs/pipeline-restart-verify-as-action/design.md`。机制保留：清单非空时本服务照旧同步。
 * - 启动时全量同步 → 页面/接口都能看到当前脚本，两端（本机 / dev）随版本自动一致；
 * - 提交发布时按模板同步一次（见 `PipelineService.submit`）→ 新模板/改过库的模板也不会漏；
 * - 手工 SQL 改过脚本？下次启动/提交会被重置 —— 这正是"平台托管"的语义，也是重置手段。
 *
 * **git 是例外（2026-09-15 用户决定）**：拉取代码是普通 shell 节点，脚本由运维在页面上维护。
 * 这里只做两件事：① 节点命令不存在时写入一次默认正文（`locked=false`）；
 * ② 存量 `locked=true` 的行**解锁并保留现内容**（把 git 交还给运维）。此后代码不再覆盖。
 *
 * 注意：用户自配的 shell 节点（build / release / …）一律不碰。
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
        this.logger.log(`平台托管脚本已同步（${changed} 个模板有变更）`);
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
   * 同步单个模板的平台脚本（幂等）+ 初始化可编辑默认脚本。
   * @returns true=有写入（内容或锁定位发生变化）
   */
  async seedForTemplate(pipelineId: string): Promise<boolean> {
    let wrote = false;
    for (const item of PLATFORM_STEP_SCRIPTS) {
      const script = getPlatformStepScript(item.nodeKey);
      const row = await this.repo.findOne({ where: { pipelineId, nodeKey: item.nodeKey } });
      if (row?.locked && row.command === script && row.enabled) continue;

      const next =
        row ?? this.repo.create({ pipelineId, nodeKey: item.nodeKey, command: '', enabled: true });
      next.command = script;
      next.actions = null;
      next.locked = true;
      next.enabled = true;
      next.updatedBy = 'system';
      await this.repo.save(next);
      wrote = true;
    }
    if (await this.ensureEditableDefaults(pipelineId)) wrote = true;
    return wrote;
  }

  /**
   * 可编辑节点的默认脚本（git）：**只补空、不覆盖、并解锁存量**。
   *
   * 与 `PLATFORM_STEP_SCRIPTS` 的托管语义刻意相反 —— 用户 2026-09-15 决定
   * 「拉取代码也是自定义节点」，所以：
   * - 没有命令行 → 写入一次默认正文（`locked=false`），让页面能直接看到并改；
   * - 已有行且被平台锁过（历史数据）→ **解锁，保留现内容**（不拿代码覆盖运维的改动）；
   * - 已有行且已解锁 → 什么都不做（用户改过的脚本永不被冲掉）。
   */
  async ensureEditableDefaults(pipelineId: string): Promise<boolean> {
    let wrote = false;
    for (const item of DEFAULT_STEP_SCRIPTS) {
      const row = await this.repo.findOne({ where: { pipelineId, nodeKey: item.nodeKey } });
      if (!row) {
        await this.repo.save(
          this.repo.create({
            pipelineId,
            nodeKey: item.nodeKey,
            command: getDefaultStepScript(item.nodeKey),
            actions: null,
            enabled: true,
            locked: false,
            updatedBy: 'system',
          }),
        );
        wrote = true;
        continue;
      }
      if (row.locked) {
        row.locked = false;
        await this.repo.save(row);
        wrote = true;
      }
    }
    return wrote;
  }
}
