import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { ReleaseLockService } from '../release-lock/release-lock.service';
import { DeployVersionEntity } from '../entities/deploy-version.entity';
import { DeployDeploymentEntity } from '../entities/deploy-deployment.entity';
import { DeployAppEntity } from '../entities/deploy-app.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { EnvSplitWriterService } from '../cloud-db/env-split-writer.service';
import { normalizeCommitRef } from '../pipeline/release-paths';

/**
 * 版本列写入断言（台账 #9027 核验修正）：归一失败直接 400。
 *
 * 🔴 **不允许** `normalizeCommitRef(x) ?? x` 这种「归一失败回退原值」——
 * `//`、全空白这类最需要兜住的输入恰好归一为 undefined，回退就等于把脏值原样落库。
 */
function requireCommitRef(ref: string | null | undefined, field: string): string {
  const v = normalizeCommitRef(ref);
  if (!v) {
    throw new BadRequestException(
      `${field} 非法：${JSON.stringify(ref ?? null)}（版本列只接受 ^[A-Za-z0-9._-]{4,64}$，且不允许 . / ..）`,
    );
  }
  return v;
}

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

  async withReleaseLock<Result>(
    input: { env: string; moduleKey: string; owner: string },
    work: () => Promise<Result>,
  ): Promise<Result> {
    if (!input.owner) throw new Error('Release lock owner required');
    return this.withLock({ env: input.env, moduleKey: input.moduleKey, lock: { owner: input.owner } }, work);
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
   * 1. 本地库写失败 → **抛出**（2026-11-13 翻转，取代 2026-10-08 的只告警：deploy_app_env_versions 已是 gateway 前端唯一读取源，静默成功=半发布事故放大器，宁可任务红）
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
    let currentVersion: string | null = null;
    try {
      const app = await this.appRepo.findOne({ where: { key: input.moduleKey } });
      if (!app) return; // 后端服务 / 未登记模块：新模型无此实体（legacy 仍是唯一指针）

      // 列契约（台账 #9027）：本表版本列只允许纯 commit；归一失败即 400，不回退脏值。
      // 放在 app 判定之后：未登记的后端服务只写 legacy，不受本表契约约束。
      currentVersion = requireCommitRef(input.currentVersion, 'current_version');
      const row =
        (await this.appVersionRepo.findOne({
          where: { appKey: input.moduleKey, envId: input.env },
        })) ?? this.appVersionRepo.create();
      if (!row.appKey) row.appKey = input.moduleKey;
      if (!row.envId) row.envId = input.env;
      // 旧值同样归一：避免出现「current=b6ec9950、previous=portal/b6ec9950」这种同版本自指；
      // 归一失败的垃圾值不写进 previous（列契约优先，回滚目标宁可缺也不留坏值）。
      const fromCommit = normalizeCommitRef(row.currentVersion);
      if (fromCommit !== currentVersion) {
        // 旧版本留作回滚目标
        row.previousVersion = fromCommit ?? null;
      }
      row.currentVersion = currentVersion;
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
      throw e; // 本地新表写失败 → 抛出（2026-11-13 翻转）：不会走到镜像，天然没有可信数据可镜像，上抛让 setPointer 判 failed，不留「半发布」
    }

    if (!written || !currentVersion) return;

    // 分流：prod 的指针镜像到云库（prod gateway 的读取源）。失败按严格语义抛出。
    await this.splitWriter.mirrorPointer({ ...input, currentVersion });
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
   * - `syncAppEnvPointer` 用于 `setPointer` 的**附赠同步**：本地失败抛出（2026-11-13 翻转，不留半发布）
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

    // 列契约（台账 #9027）：本表版本列只允许纯 commit。上游 versionTag 可能是
    // `<templateKey>/<commit>`（如 portal/b6ec9950），落库前归一；归一失败即 400。
    const currentVersion = requireCommitRef(input.currentVersion, 'current_version');
    // 比较也用归一值：历史脏值 `portal/b6ec9950` 与纯 commit 是同一版本（否则每次都被判成真变更、
    // 刷 deployed_at）；但拼写不同仍写一次，让存量脏值自愈。
    const sameCommit = normalizeCommitRef(from) === currentVersion;
    const unchanged = from === currentVersion;

    if (!unchanged) {
      if (!row.appKey) row.appKey = input.moduleKey;
      if (!row.envId) row.envId = input.env;
      if (input.previousVersion !== undefined) {
        row.previousVersion =
          input.previousVersion === null
            ? null
            : requireCommitRef(input.previousVersion, 'previous_version');
      } else if (sameCommit) {
        // 只是历史拼写差异（portal/b6ec9950 vs b6ec9950），不是真变更 → 保留原 previous（归一后）
        row.previousVersion = normalizeCommitRef(previous) ?? null;
      } else {
        row.previousVersion = normalizeCommitRef(from) ?? null;
      }
      row.currentVersion = currentVersion;
      row.status = 'deployed';
      row.deployedAt = new Date();
      row.deployedBy = input.deployedBy;
      if (input.taskId) row.taskId = input.taskId;
      await this.appVersionRepo.save(row);
    }

    // 分流：prod 必须镜像到云库（gateway 的读取源）。strict 下失败即抛。
    if (!unchanged) {
      await this.splitWriter.mirrorPointer({ ...input, currentVersion });
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

  async currentAppVersion(env: string, moduleKey: string): Promise<string | undefined> {
    const pointer = await this.appVersionRepo.findOne({ where: { envId: env, appKey: moduleKey } });
    return pointer?.currentVersion ?? undefined;
  }

  /**
   * 回滚目标的**唯一取法**（诊断 #17）。
   *
   * 此前两个入口各查一处：env-dir 读指针表 `deploy_app_env_versions.previous_version`，
   * 后端读历史表 `deploy_versions` 里「最近一条非当前版本」——
   * 两处口径不同，同一模块在不同页面点回滚可能得到不同目标。
   *
   * 统一口径：**指针表的 previous_version 优先**（它就是「上一次生效的版本」，
   * 写指针时同步维护，语义最准）；指针表没有记录时才回落历史表（后端 legacy 只写
   * `deploy_deployments`，新表里可能压根没行）。
   *
   * **契约边界（台账 #9027 第二轮，方案 A″，2026-11-26）**：本函数只回答「回滚到哪个
   * 版本**引用**」，**不做跨契约归一**，三个分支都原样返回来源里的值（`explicit` 传入值、
   * `previous_version` 原值、历史行 `versionTag` 原值）。
   *
   * - `deploy_app_env_versions.*_version` 的**纯 commit 契约**由三个写入处各自校验保证
   *   （`setAppEnvPointerInner` / `syncAppEnvPointerInner` 用 `requireCommitRef`；
   *   `mirrorPointer` 在 `env-split-writer.service.ts` 内联判等后 throw）—— 归一只发生在写列处。
   * - 归一**比对**仍在本函数内保留（只用于「判断是不是同一个版本」）：历史脏值
   *   `portal/b6ec9950` 与 `b6ec9950` 必须视为同版本，否则会把当前版本自己选成回滚目标
   *   → 下游 `from === currentVersion` → 静默 no-op（P1 回归）。
   * - **`previous == current` 是合法状态，不是脏数据**（第五轮补充）：同一 commit 连续发布
   *   两次时，`previous_version` 会忠实记录成与 `current_version` 相同的值（如 prod shell 的
   *   `a82270f9` 于 14:23 / 14:33 各发一次，见台账 #9027 数据侧取证）。本函数视其为
   *   「没有可用的 previous」，继续回落历史表找真正更早的**不同**版本 —— 而不是抛错，
   *   因为抛错会把「本可自救」变成「不可自救」（历史表里通常还有更早的版本）。
   * - `explicit` 分支是唯一**没有回落路径**的入口，故它做两道前置校验（归一值**只用于判等**，
   *   **返回值仍是原始引用**）：归一失败（`..` / 空段）→ 400，堵住下游 `path.join` 穿越；
   *   归一后等于 current → 400（否则「回滚到当前版本」会被下游 `unchanged: true` 静默吃掉）。
   * - 两类消费者需求**相反**，故不能统一成一种形态：
   *   - app / env-dir：`doSwitchVersion` 的三个 IO 点（`hasVersion` / `writePointer` /
   *     指针列）本就对原始引用容错 —— `env-artifact.service.ts` 的 `hasVersion` 与
   *     `writePointer` 都经 `resolveVersion()`，其 `legacyVersionCandidates` 是
   *     **原始值优先、归一值兜底**。所以传原始引用最稳（`portal/b6ec9950` 也命中）。
   *   - 后端：`applyBackendVersion` 直接
   *     `path.join(ws,'servers',dir,versionTag)`，`runtime-checkpoint/<id>` 是磁盘上
   *     **真实的一级目录**，剥掉前缀会指向不存在的目录。
   */
  async resolveRollbackTarget(input: {
    env: string;
    moduleKey: string;
    /** 显式指定目标版本（UI「回滚到此版本」按行传入） */
    to?: string;
  }): Promise<{ from: string | null; to: string; source: 'explicit' | 'pointer' | 'history' }> {
    const explicit = input.to?.trim();
    const row = await this.appVersionRepo.findOne({
      where: { appKey: input.moduleKey, envId: input.env },
    });
    const from = row?.currentVersion ?? null;
    // 比较口径统一归一（台账 #9027）：历史脏值 `portal/b6ec9950` 与 `b6ec9950` 是同一版本。
    const fromCommit = normalizeCommitRef(from);

    // 三种来源都要覆盖：explicit / previous_version / 历史表 versionTag。
    // 三者都原样返回来源引用（契约边界见函数头 JSDoc）：列归一只在写列处做，
    // 产物解析侧的 `resolveVersion` 已「原始值优先、归一值兜底」。
    if (explicit) {
      // 格式校验（台账 #9027 第五轮 · D11）：归一失败（`..` / 空段 / 超短）→ 400，
      // 堵住下游 `applyBackendVersion` 的 path.join(ws,'servers',dir,versionTag) 路径穿越；
      // 但**返回的仍是原始引用** —— `runtime-checkpoint/<id>` 与 `portal/<commit>` 都要原样透传。
      // 🔴 校验与归一是**两件事**：A″ 之前把「撤掉剥前缀」和「撤掉校验」当成一件事一起做，
      //    才是这处回退的根因 —— 不需要在「剥前缀」和「不校验」之间二选一。
      // 🔴 `explicitRef` 是**归一值，仅用于判等**；返回值仍是**原始引用** `explicit`
      //    （`portal/b6ec9950` 与 `b6ec9950` 判等相等，但下游要的是原样引用）。
      const explicitRef = requireCommitRef(explicit, '回滚目标');
      // 「回滚到当前版本」= 退化操作。`explicit` 分支**没有回落路径**（不像 previous 分支
      // 还能继续找更早版本），留着必被下游吃掉：app 链 `unchanged: true` 静默成功
      // （apps.service.ts:585，线上一个字没改却报成功）；后端链虽有 deploy.service.ts:1193-1194
      // 的守卫，但那是**精确**比较，跨拼写（`b6ec9950` vs `portal/b6ec9950`）会漏网。
      // 故此处用归一值判等后直接 400；文案要与上面格式校验的 400 区分开，便于排查。
      if (explicitRef === fromCommit) {
        throw new BadRequestException(`回滚失败: ${explicit} 就是当前版本（${from}），无需回滚`);
      }
      return { from, to: explicit, source: 'explicit' };
    }

    if (row?.previousVersion) {
      // normalizeCommitRef 只作**有效性判定**：无效（历史垃圾值如 `..`）视同没有 → 回落历史表；
      // 有效则返回**原始**值（可能是合法的 `portal/c0ffee02` 形态）。
      const prevRef = normalizeCommitRef(row.previousVersion);
      // 🔴 `previous == current` 是**合法状态**，不是脏数据（台账 #9027 第五轮）：
      // 同一 commit 连续发布两次时（如 shell@prod 的 a82270f9 于 14:23 与 14:33 各发一次），
      // 第 2 次发布时 current 已是 a82270f9，previous 便忠实记录成同一个值。
      // 但它不能当回滚目标 —— 那是「回滚到自己」：app 链 doSwitchVersion 会
      // `unchanged: true` 静默成功（apps.service.ts:585），又是一次静默 no-op。
      // 故视同「没有可用的 previous」，继续回落历史表找真正更早的**不同**版本。
      if (prevRef && prevRef !== fromCommit) {
        return { from, to: row.previousVersion, source: 'pointer' };
      }
    }

    // 回落历史表（后端 legacy）
    const dep = await this.deploymentRepo.findOne({
      where: { envId: input.env, moduleKey: input.moduleKey },
    });
    const rows = await this.versionRepo.find({
      where: { env: input.env, component: input.moduleKey },
      order: { releasedAt: 'DESC' } as never,
    });
    // 比对用**归一值**（P1 修复不动）：命中的行返回它**原始**的 versionTag，
    // 因为下游要拿原始引用来拼产物路径 / 后端目录（见函数头 JSDoc 的契约边界）。
    const prevRow = rows.find((r) => {
      const ref = normalizeCommitRef(r.versionTag);
      return !!ref && ref !== fromCommit && ref !== normalizeCommitRef(dep?.currentVersion);
    });
    if (!prevRow?.versionTag) {
      throw new BadRequestException(
        `没有可回滚的历史版本：${input.moduleKey}@${input.env} 的指针表无 previous_version，` +
          `deploy_versions 里也没有其他版本`,
      );
    }
    return { from: from ?? dep?.currentVersion ?? null, to: prevRow.versionTag, source: 'history' };
  }

  /** 按版本标签查版本记录（复用产物时回填 gitCommit 用；跨 env 任意一条即可） */
  async findByVersionTag(versionTag: string): Promise<DeployVersionEntity | undefined> {
    return (await this.versionRepo.findOne({ where: { versionTag } })) ?? undefined;
  }
}
