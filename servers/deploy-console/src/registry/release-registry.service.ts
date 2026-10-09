import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { EnvSplitWriterService } from '../cloud-db/env-split-writer.service';

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

/**
 * 写入指针时**顺带申请**的发布锁（诊断 #6）。
 *
 * 为什么要有它：`ReleaseLockService` 此前只被流水线使用，UI 切换/回滚、UI 部署、
 * 内部脚本接口这些**非流水线入口**全裸奔——连点两次就交叉覆盖，
 * `previous_version` 被写成错值后**回滚目标直接丢失**。
 *
 * `owner` 建议带来源前缀（`ui:<人>` / `script:<流水线>` / `deploy:<模块>`），
 * 便于排障时看出是谁在发。流水线路径**不要传**：它自己持有跨阶段的锁，
 * 传进来会变成重入（不释放），属于白跑一次。
 */
export interface PointerLock {
  owner: string;
  ttlMs?: number;
}

export interface SetPointerInput {
  env: string;
  moduleKey: string;
  currentVersion: string;
  deployedBy?: string;
  taskId?: string;
  /** 本次写入是否申请发布锁（非流水线入口必填） */
  lock?: PointerLock;
  /**
   * 乐观并发校验（CAS）：期望的**变更前**版本。
   * 与实际读到不一致即抛 `ConflictException`——在调用方已持锁时等价于串行化校验，
   * 用来挡住「页面显示 v1、实际已是 v2，还按 v1 提交」这类覆盖。
   */
  expectedFrom?: string | null;
  /**
   * 回滚补偿用：显式指定 `previous_version`。
   * 不传则取「变更前的值」（正常推进语义）；补偿场景需把旧值原样带回来，
   * 否则回滚后 previous 会指向那个**没生效的失败目标**。
   */
  previousVersion?: string | null;
}

export interface AppEnvPointerResult {
  /** 变更前的 current_version（首次写入为 null） */
  from: string | null;
  /** 变更前的 previous_version */
  previous: string | null;
  /** 目标版本与当前值相同 → 未做任何写入（含镜像） */
  unchanged: boolean;
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
 * `deploy_apps` 中登记（前端应用：`env-dir` **或** `site-version`），同步 upsert
 * `deploy_app_env_versions` —— gateway NEW 域的 `byEnv` / 基座 shell 只读后者。
 * 后端服务（不在 `deploy_apps`）只写 legacy，见 DeployDeploymentEntity 注释。
 *
 * 为什么前端仍双写：gateway 已停用 legacy 读取源（2026-09-28），新表是**唯一**前端读取源；
 * 继续写旧表只是为了让「应急开关 `DEPLOY_LEGACY_READ=1`」与运维排障仍有可比对的数据。
 * ⚠️ 两轨出现差异时**以新表为准**。
 *
 * **按环境分流（2026-10-08，specs/deploy-console-env-datasource/design.md）**：
 * prod 的指针必须**同时**写云数据库——prod gateway 在广州 VPC 内网读云库，
 * 而 console 在 dev 机（南京）只能走公网写云库。此前只有 dev 本机库被自动更新，
 * prod 指针靠人工同步，导致 prod 发布「显示成功但线上没切」（2026-09-30 基座事故）。
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
    /** 按环境分流的镜像写（prod → 云数据库，公网） */
    private readonly splitWriter: EnvSplitWriterService,
    /** 发布锁（诊断 #6）：指针写入是「改线上真相」的动作，必须串行化 */
    private readonly locks: ReleaseLockService,
  ) {}

  /**
   * 可选的锁包装：只有显式传 `lock` 的调用才受保护（流水线自带锁，不传）。
   *
   * **释放条件**：仅当本次**新拿到**锁才释放。重入场景（外层已持有同一 owner 的锁）
   * 释放会把外层还在用的锁删掉 —— 后面阶段就没保护了。
   */
  private async withLock<T>(
    input: { env: string; moduleKey: string; lock?: PointerLock },
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!input.lock) return fn();
    const r = await this.locks.acquireEx(
      input.moduleKey,
      input.env,
      input.lock.owner,
      input.lock.ttlMs,
    );
    if (!r.ok) {
      // ⚠️ 别直接 `new Date(r.expiresAt)`：expires_at 是 bigint 列，驱动可能给回字符串，
      // 一旦非法就是 RangeError → 409 冲突被吞成 500（真实原因反而看不见）
      const until = Number(r.expiresAt);
      const untilText =
        Number.isFinite(until) && until > 0 ? `（至 ${new Date(until).toISOString()}）` : '';
      throw new ConflictException(
        `并发发布被拒绝：${input.moduleKey}@${input.env} 正被 ${r.holder ?? '未知持有者'} 占用` +
          `${untilText}；请稍后重试，确认无人发布后再强制解锁`,
      );
    }
    try {
      return await fn();
    } finally {
      if (r.newly) {
        await this.locks.release(input.moduleKey, input.env, input.lock.owner);
      }
    }
  }

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
    return this.withLock(input, async () => {
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

      // 分流：prod 的 legacy 指针同步到云库（应急读取源，写失败不阻断）
      await this.splitWriter.mirrorLegacyPointer(input);

      // 双写：前端 env-dir 应用同步到 deploy_app_env_versions（gateway byEnv 的读取源）
      // 已在锁内 → 走 inner，不再重复申请锁
      await this.syncAppEnvPointerInner(input);
    });
  }

  /**
   * 把指针同步到新模型（**所有前端应用**：env-dir 与 site-version）。
   *
   * `site-version`（基座 shell）同样要写：gateway 的 `resolveShellHtmlFile`
   * 停用 legacy 后从本表读版本（目录 `static/modules/<key>/<envId>/<version>/`）。
   *
   * **失败语义（分两段，2026-10-08 修正）**：
   * 1. 本地库写失败 → **只告警**（沿用原语义：legacy 已写成功，运维可从告警发现两轨不一致）
   * 2. 本地成功、但 **prod 云库镜像失败** → **抛出**（见 EnvSplitWriterService）
   *
   * ⚠️ 第 2 条是本次修正的核心。原注释「失败只告警不抛出」在单库时代是合理止损，
   * 分流后却成了事故放大器：本地成功 + 云库失败 = 流水线显示成功、prod 实际仍跑旧版本，
   * 与 2026-09-30 基座事故形态完全一致。宁可让任务红掉，也不要静默不一致。
   *
   * 单独调用（非 `setPointer` 内嵌）时按 `input.lock` 取锁；`setPointer` 已锁则走 inner。
   */
  async syncAppEnvPointer(input: SetPointerInput): Promise<void> {
    return this.withLock(input, () => this.syncAppEnvPointerInner(input));
  }

  private async syncAppEnvPointerInner(input: SetPointerInput): Promise<void> {
    let written = false;
    try {
      const app = await this.appRepo.findOne({ where: { key: input.moduleKey } });
      if (!app) return; // 后端服务 / 未登记模块：新模型无此实体（legacy 仍是唯一指针）

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
      written = true;
    } catch (e) {
      this.logger.warn(
        `同步 deploy_app_env_versions 失败（legacy 已写成功，两轨可能不一致）：${(e as Error).message}`,
      );
      return; // 本地都没写成功，没有可信数据可镜像
    }

    if (!written) return;

    // 分流：prod 的指针镜像到云库（prod gateway 的读取源）。失败按严格语义抛出。
    await this.splitWriter.mirrorPointer(input);
  }

  /**
   * **应用域指针写入的唯一入口**（2026-10-09 收敛，诊断 #1）。
   *
   * 背景：`AppsService.switchVersion` 原先自己 `versionRepo.save()`，**从不写云库**，
   * 而 UI 切换/回滚、UI 部署、流水线 `internal/release/pointer` 三条路全部走它 →
   * prod 表现为「发布成功但线上没变」且**不报错**（2026-09-30 基座事故的同一形态）。
   *
   * 与 `syncAppEnvPointer` 的分工：
   * - 本方法用于**用户/脚本主动切版本**：本地写失败即抛（不留半成功），
   *   prod 云库镜像按严格语义抛（见 `EnvSplitWriterService`）
   * - `syncAppEnvPointer` 用于 `setPointer` 的**附赠同步**：本地失败只告警
   *   （legacy 已写成功，运维可从告警发现两轨不一致）
   *
   * 幂等：目标版本 == 当前版本时**不写库也不镜像**。
   * （否则同值推进会让两库 `deployed_by/deployed_at` 持续漂移，见 design §13 P2）
   */
  async setAppEnvPointer(input: SetPointerInput): Promise<AppEnvPointerResult> {
    return this.withLock(input, () => this.setAppEnvPointerInner(input));
  }

  private async setAppEnvPointerInner(input: SetPointerInput): Promise<AppEnvPointerResult> {
    const app = await this.appRepo.findOne({ where: { key: input.moduleKey } });
    if (!app) {
      throw new NotFoundException(
        `应用未登记于 deploy_apps：${input.moduleKey}（应用域指针需先注册应用）`,
      );
    }

    const row =
      (await this.appVersionRepo.findOne({
        where: { appKey: input.moduleKey, envId: input.env },
      })) ?? this.appVersionRepo.create();

    const from = row.currentVersion ?? null;
    const previous = row.previousVersion ?? null;

    // CAS（诊断 #6）：调用方看到的是旧值就别写了 —— 否则会把别人刚推进的版本盖掉，
    // 且 `previous_version` 会被写成那个「没真正生效过」的值，回滚目标随之丢失。
    if (input.expectedFrom !== undefined && from !== input.expectedFrom) {
      throw new ConflictException(
        `版本已被并发修改：${input.moduleKey}@${input.env} 期望当前为 ` +
          `${input.expectedFrom ?? '（空）'}，实际为 ${from ?? '（空）'}；请刷新后重试`,
      );
    }

    const unchanged = from === input.currentVersion;

    if (!unchanged) {
      if (!row.appKey) row.appKey = input.moduleKey;
      if (!row.envId) row.envId = input.env;
      row.previousVersion = input.previousVersion !== undefined ? input.previousVersion : from;
      row.currentVersion = input.currentVersion;
      row.status = 'deployed';
      row.deployedAt = new Date();
      row.deployedBy = input.deployedBy;
      if (input.taskId) row.taskId = input.taskId;
      await this.appVersionRepo.save(row);
    }

    // 分流：prod 必须镜像到云库（gateway 的读取源）。strict 下失败即抛。
    if (!unchanged) {
      await this.splitWriter.mirrorPointer(input);
    }

    return { from, previous, unchanged };
  }

  /**
   * 删除应用域指针行（**回滚补偿**用：首次写入失败时把空指针清掉）。
   * 两库都要删，否则云库会残留一条「没生效」的指针。
   */
  async clearAppEnvPointer(appKey: string, envId: string): Promise<void> {
    const row = await this.appVersionRepo.findOne({ where: { appKey, envId } });
    if (!row) return;
    await this.appVersionRepo.remove(row);
    this.splitWriter.deleteMirror('deploy_app_env_versions', {
      app_key: appKey,
      env_id: envId,
    });
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
