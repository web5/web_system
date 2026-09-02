import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DeployModuleHookEntity } from '../entities/deploy-module-hook.entity';
import { PIPELINE_STAGES } from '../entities/deploy-pipeline.entity';

/**
 * 发布脚本 Hook 服务。
 *
 * - DB 为真相源；`resolveScript` 返回某模块某阶段的脚本（无则 null → 流水线用内置逻辑）
 * - `ensureHookFile` 把脚本落盘到发布目录 `hooks/<moduleKey>/<stage>.sh` 作为执行载体
 * - 保存前强制 `bash -n` 语法校验
 * - 脚本编辑是管理操作，只走控制台（不暴露 MCP）
 */
@Injectable()
export class HookService {
  private readonly logger = new Logger(HookService.name);

  constructor(
    @InjectRepository(DeployModuleHookEntity)
    private readonly hookRepo: Repository<DeployModuleHookEntity>,
    private readonly configService: ConfigService,
  ) {}

  private get releaseWorkspace(): string {
    return (
      this.configService.get<string>('RELEASE_WORKSPACE') ||
      path.join(process.env.HOME || '/data', 'web_system_release')
    );
  }

  /** 该模块所有阶段的状态（含未配置项，便于前端渲染） */
  async list(moduleKey: string): Promise<
    Array<{ stage: string; configured: boolean; enabled: boolean; updatedAt?: Date; updatedBy?: string }>
  > {
    const hooks = await this.hookRepo.find({ where: { moduleKey } });
    const map = new Map(hooks.map((h) => [h.stage, h]));
    return PIPELINE_STAGES.map((stage) => {
      const h = map.get(stage);
      return {
        stage,
        configured: !!h,
        enabled: h?.enabled ?? false,
        updatedAt: h?.updatedAt,
        updatedBy: h?.updatedBy,
      };
    });
  }

  /** 取某模块某阶段的脚本；无配置返回 null（流水线用内置逻辑） */
  async get(moduleKey: string, stage: string): Promise<DeployModuleHookEntity | null> {
    return this.hookRepo.findOne({ where: { moduleKey, stage } });
  }

  /** 校验脚本语法（bash -n），语法错误直接抛 400 */
  validateScript(script: string): void {
    if (!script || !script.trim()) {
      throw new BadRequestException('脚本内容不能为空');
    }
    try {
      // 用绝对路径执行：服务进程 PATH 可能不含 bash（此前多次出现 command not found）
      execSync('/bin/bash -n', { input: script, encoding: 'utf-8' });
    } catch (e) {
      const msg = (e as Error).message.split('\n').slice(-2).join(' ');
      throw new BadRequestException(`shell 语法错误: ${msg}`);
    }
  }

  /** 保存脚本（先语法校验再入库） */
  async save(
    moduleKey: string,
    stage: string,
    script: string,
    operator?: string,
  ): Promise<{ moduleKey: string; stage: string; updatedAt: Date }> {
    this.assertStage(stage);
    this.validateScript(script);

    const existing = await this.get(moduleKey, stage);
    const now = new Date();
    if (existing) {
      existing.script = script;
      existing.enabled = true;
      existing.updatedBy = operator;
      existing.updatedAt = now;
      await this.hookRepo.save(existing);
    } else {
      const h = this.hookRepo.create({
        moduleKey,
        stage,
        script,
        enabled: true,
        updatedBy: operator,
      });
      await this.hookRepo.save(h);
    }
    this.logger.log(`已保存发布脚本: ${moduleKey}/${stage} (by ${operator})`);
    return { moduleKey, stage, updatedAt: now };
  }

  /** 删除脚本（恢复流水线内置逻辑） */
  async remove(moduleKey: string, stage: string): Promise<{ ok: boolean }> {
    this.assertStage(stage);
    const h = await this.get(moduleKey, stage);
    if (!h) throw new NotFoundException(`模块 ${moduleKey} 未配置 ${stage} 阶段脚本`);
    await this.hookRepo.remove(h);
    // 清理落盘缓存
    try {
      const file = this.hookFilePath(moduleKey, stage);
      if (fs.existsSync(file)) fs.rmSync(file);
    } catch (e) {
      this.logger.warn(`清理 hook 缓存文件失败: ${(e as Error).message}`);
    }
    return { ok: true };
  }

  /** 按模块类型返回默认脚本模板（供「插入模板」使用） */
  templates(type: string): Record<string, string> {
    const isBackend = type === 'backend';
    const mk = (body: string) => `#!/usr/bin/env bash\n# 阶段可用环境变量：` +
      `DEPLOY_ENV / MODULE_KEY / BRANCH / COMMIT_ID / RELEASE_DIR / STAGE / MODULE_TYPE / MODULE_DIR / PM2_NAME\n${body}`;
    return {
      check: mk('echo "[hook:check] 自定义前置校验，非零退出码会中断发布"\n'),
      pull: mk(
        '# 默认内置：发布目录 git fetch + checkout 分支 + reset commit\n' +
          '# 如需自定义代码获取（如拉子模块），在此实现；echo 输出会进流水线日志\n',
      ),
      build: isBackend
        ? mk('cd "$RELEASE_DIR/servers/$MODULE_DIR"\necho "[hook:build] 后端构建"\nnpx nest build\n')
        : mk('cd "$RELEASE_DIR/apps/$MODULE_DIR"\necho "[hook:build] 前端打包"\nnpx vite build --mode mf\n'),
      upload: mk('echo "[hook:upload] 自定义产物投递（默认由流水线处理）"\n'),
      restart: isBackend
        ? mk('echo "[hook:restart] 重启服务"\nnpx pm2 restart "$PM2_NAME" --update-env\n')
        : mk('echo "[hook:restart] 前端无重启动作"\n'),
      verify: mk('echo "[hook:verify] 自定义健康检查，非零退出码视为发布失败"\n'),
      cleanup: mk('echo "[hook:cleanup] 自定义清理策略"\n'),
    };
  }

  /** 执行载体文件路径：<releaseDir>/hooks/<moduleKey>/<stage>.sh */
  hookFilePath(moduleKey: string, stage: string): string {
    return path.join(this.releaseWorkspace, 'hooks', moduleKey, `${stage}.sh`);
  }

  /**
   * 把脚本落盘为执行载体文件。
   * 每次执行都从 DB 覆盖写，保证「修改后立即用新脚本」。
   */
  ensureHookFile(moduleKey: string, stage: string, script: string): string {
    const file = this.hookFilePath(moduleKey, stage);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, script, { encoding: 'utf-8', mode: 0o755 });
    return file;
  }

  /** 解析某模块某阶段的执行脚本；未配置返回 null */
  async resolveScript(
    moduleKey: string,
    stage: string,
  ): Promise<{ script: string; file: string } | null> {
    const h = await this.get(moduleKey, stage);
    if (!h || !h.enabled) return null;
    const file = this.ensureHookFile(moduleKey, stage, h.script);
    return { script: h.script, file };
  }

  private assertStage(stage: string): void {
    if (!PIPELINE_STAGES.includes(stage as any)) {
      throw new BadRequestException(`非法阶段: ${stage}（支持 ${PIPELINE_STAGES.join('/')}）`);
    }
  }
}
