import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';

export interface RegisterVersionInput {
  env: string;
  moduleKey: string;
  versionTag: string;
  gitCommit?: string;
  gitBranch?: string;
  releasedBy?: string;
  /** 发布流水线任务 ID（可选，旧脚本流无） */
  taskId?: string;
  note: string;
}

export interface SetPointerInput {
  env: string;
  moduleKey: string;
  currentVersion: string;
  deployedBy?: string;
  taskId?: string;
}

/**
 * 版本注册表工具（version/pointer 内置步骤的执行体）。
 *
 * deploy_versions（发布记录）+ deploy_deployments（当前版本指针）是发布语义真相源，
 * 旧坑「版本表写在 web_system 库 / 指针与产物不一致」由本工具统一承载写入：
 * - 库 = web_system_deploy（gateway 独立数据源，TypeORM 连接已指向该库）
 * - setPointer 恒为 upsert（envId+moduleKey 唯一行）
 *
 * 收敛自 pipeline.service.ts 的 stageVersion / stagePointer / switchPointer / promote 中的
 * 版本写入逻辑，流水线各阶段与历史版本切换共用，避免再次漂移。
 *
 * **双写（2026-09-28）**：`setPointer` 在写完 legacy 指针后，若该 moduleKey 在
 * `deploy_apps` 中登记为 `deploy_mode='env-dir'`（前端 env-dir 应用），同步 upsert
 * `deploy_app_env_versions` —— gateway NEW 域的 `byEnv` 只读后者。
 * 后端服务（新模型无载体）只写 legacy，见 DeployDeploymentEntity 注释。
 *
 * 为什么双写而不是直接切：两轨并存期，旧 shell 仍消费 legacy `modules[]`，
 * 只写新表会让它停在旧版本（且无任何报错）。双写保证两侧一致，
 * 待 `deploy_sites` 全环境铺开 + shell 全量升级后再停写 legacy。
 */
@Injectable()
export class ReleaseRegistryService {
  private readonly logger = new Logger(ReleaseRegistryService.name);

  constructor(
    @InjectRepository(DeployVersionEntity)
    private readonly versionRepo: Repository<DeployVersionEntity>,
    @InjectRepository(DeployDeploymentEntity)
    private readonly deploymentRepo: Repository<DeployDeploymentEntity>,
    @InjectRepository(DeployAppEntity)
    private readonly appRepo: Repository<DeployAppEntity>,
    @InjectRepository(DeployAppEnvVersionEntity)
    private readonly appVersionRepo: Repository<DeployAppEnvVersionEntity>,
  ) {}

  /** 写一条版本发布记录（deploy_versions） */
  async registerVersion(input: RegisterVersionInput): Promise<void> {
    const v = this.versionRepo.create({
      env: input.env,
      component: input.moduleKey,
      versionTag: input.versionTag,
      gitCommit: input.gitCommit,
      gitBranch: input.gitBranch,
      releasedBy: input.releasedBy,
      releasedAt: new Date(),
      status: 'active',
      taskId: input.taskId,
      note: input.note,
    });
    await this.versionRepo.save(v);
  }

  /** upsert 当前版本指针（deploy_deployments，envId+moduleKey 唯一行） */
  async setPointer(input: SetPointerInput): Promise<void> {
    const existing = await this.deploymentRepo.findOne({
      where: { envId: input.env, moduleKey: input.moduleKey },
    });
    const row = existing ?? this.deploymentRepo.create();
    row.envId = input.env;
    row.moduleKey = input.moduleKey;
    row.currentVersion = input.currentVersion;
    row.status = 'deployed';
    row.deployedAt = new Date();
    row.deployedBy = input.deployedBy;
    if (input.taskId) row.taskId = input.taskId;
    await this.deploymentRepo.save(row);

    // 双写：前端 env-dir 应用同步到 deploy_app_env_versions（gateway byEnv 的读取源）
    await this.syncAppEnvPointer(input);
  }

  /**
   * 把指针同步到新模型（前端 env-dir 应用）。
   *
   * **失败只告警不抛出**：新表是「增量真相源」，写失败不该让整条流水线红掉
   * （legacy 已写成功，页面仍可用；运维可从告警发现两轨不一致）。
   */
  async syncAppEnvPointer(input: SetPointerInput): Promise<void> {
    try {
      const app = await this.appRepo.findOne({ where: { key: input.moduleKey } });
      if (!app) return;                       // 后端服务 / 未登记模块：新模型无此实体
      if (app.deployMode !== 'env-dir') return; // shell 走 site-version，不纳入 env 切换

      const row =
        (await this.appVersionRepo.findOne({
          where: { appKey: input.moduleKey, envId: input.env },
        })) ?? this.appVersionRepo.create();
      if (!row.appKey) row.appKey = input.moduleKey;
      if (!row.envId) row.envId = input.env;
      // 旧版本留作回滚目标
      row.previousVersion = row.currentVersion ?? null;
      row.currentVersion = input.currentVersion;
      row.status = 'deployed';
      row.deployedAt = new Date();
      row.deployedBy = input.deployedBy;
      if (input.taskId) row.taskId = input.taskId;
      await this.appVersionRepo.save(row);
    } catch (e) {
      this.logger.warn(
        `同步 deploy_app_env_versions 失败（legacy 已写成功，两轨可能不一致）：${(e as Error).message}`,
      );
    }
  }

  /** 当前线上版本（指针），无记录返回 undefined */
  async currentVersion(env: string, moduleKey: string): Promise<string | undefined> {
    const dep = await this.deploymentRepo.findOne({ where: { envId: env, moduleKey } });
    return dep?.currentVersion;
  }

  /** 按版本标签查版本记录（复用产物时回填 gitCommit 用；跨 env 任意一条即可） */
  async findByVersionTag(versionTag: string): Promise<DeployVersionEntity | undefined> {
    return (await this.versionRepo.findOne({ where: { versionTag } })) ?? undefined;
  }
}
