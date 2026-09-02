import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';

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
 */
@Injectable()
export class ReleaseRegistryService {
  constructor(
    @InjectRepository(DeployVersionEntity)
    private readonly versionRepo: Repository<DeployVersionEntity>,
    @InjectRepository(DeployDeploymentEntity)
    private readonly deploymentRepo: Repository<DeployDeploymentEntity>,
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
