import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DeployModuleStageCommandEntity,
  CONFIGURABLE_STAGES,
  DEFAULT_BUILD_TEMPLATE,
} from '../entities/deploy-module-stage-command.entity';

export interface ResolvedStageCommand {
  command: string;
  timeoutSec?: number;
}

/**
 * 阶段命令真相源：每模块每阶段一条 shell 命令。
 *
 * 替代历史上两套互斥机制（`deploy_modules.buildCmd` 与 `deploy_module_hooks`），
 * 见 specs/release-platform/design.md 决策 1。
 */
@Injectable()
export class StageCommandService {
  constructor(
    @InjectRepository(DeployModuleStageCommandEntity)
    private readonly repo: Repository<DeployModuleStageCommandEntity>,
  ) {}

  /** 解析模块某阶段命令；未配置或未启用返回 null */
  async resolve(moduleKey: string, stage: string): Promise<ResolvedStageCommand | null> {
    const row = await this.repo.findOne({ where: { moduleKey, stage, enabled: true } });
    if (!row?.command?.trim()) return null;
    return { command: row.command, timeoutSec: row.timeoutSec ?? undefined };
  }

  /**
   * shell 语法校验（bash -n）。
   *
   * 阶段命令是任意 shell，保存前必须校验：既防手滑语法错误导致发布中途失败，
   * 也避免把非法内容写进真相源。写临时文件而非 heredoc，规避命令体包含 EOF 的冲突。
   */
  validate(command: string): void {
    if (!command?.trim()) throw new BadRequestException('命令不能为空');
    const tmp = path.join(
      os.tmpdir(),
      `stage-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`,
    );
    try {
      fs.writeFileSync(tmp, command, 'utf8');
      execSync(`bash -n "${tmp}"`, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const stderr = (e as { stderr?: Buffer })?.stderr?.toString();
      throw new BadRequestException(`shell 语法错误：${stderr || (e as Error).message}`);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  /** 按模块类型返回默认构建命令模板 */
  template(type: string): string | null {
    return DEFAULT_BUILD_TEMPLATE[type] ?? null;
  }

  /** 列出模块全部阶段命令 */
  async listByModule(moduleKey: string): Promise<DeployModuleStageCommandEntity[]> {
    return this.repo.find({ where: { moduleKey }, order: { stage: 'ASC' } });
  }

  /** 新增或更新阶段命令（页面配置入口） */
  async upsert(
    moduleKey: string,
    stage: string,
    command: string,
    updatedBy?: string,
    timeoutSec?: number,
  ): Promise<DeployModuleStageCommandEntity> {
    if (!(CONFIGURABLE_STAGES as readonly string[]).includes(stage)) {
      throw new BadRequestException(
        `阶段 ${stage} 不可配置：version/pointer 是发布语义真相源，固定由流水线执行`,
      );
    }
    if (!command?.trim()) {
      throw new BadRequestException('命令不能为空');
    }
    this.validate(command); // 保存前 bash -n 语法校验

    let row = await this.repo.findOne({ where: { moduleKey, stage } });
    if (!row) {
      row = this.repo.create({ moduleKey, stage, command: command.trim(), enabled: true });
    } else {
      row.command = command.trim();
      row.enabled = true;
    }
    row.updatedBy = updatedBy;
    if (timeoutSec !== undefined) row.timeoutSec = timeoutSec;
    return this.repo.save(row);
  }

  /** 删除阶段命令（该阶段恢复为流水线内置逻辑） */
  async remove(moduleKey: string, stage: string): Promise<void> {
    await this.repo.delete({ moduleKey, stage });
  }
}
