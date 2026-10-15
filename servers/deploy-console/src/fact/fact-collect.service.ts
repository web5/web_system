import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  DeployFactSnapshotEntity,
  FactKind,
  FactStatus,
  FACT_ALERT_STATUSES,
} from '../entities/deploy-fact-snapshot.entity';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { DeployServiceEnvEntity } from '../entities/deploy-service-env.entity';
import { SshExecService } from '../remote/ssh-exec.service';
import { CommandService } from '../shell/command.service';
import { resolveStaticTarget, envArtifactsRel } from '../apps/static-target';
import { defaultReleaseWorkspace } from '../pipeline/release-paths';
import {
  cmdCountEntries,
  cmdListeningPorts,
  cmdPm2List,
  cmdReadFile,
  UnsafeFactCommandError,
} from './fact-command';
import {
  parseEntryCount,
  parseListeningPorts,
  parsePm2Processes,
  parsePointerCommit,
} from './fact-parse';
import { classifyFact } from './fact-compare';

export interface FactItem {
  kind: FactKind;
  targetKey: string;
  expected: string | null;
  actual: string | null;
  status: FactStatus;
  detail?: Record<string, unknown> | null;
}

export interface FactBatchReport {
  batchId: string;
  env: string;
  /** 采集自哪台机器（本机 = local） */
  host: string;
  ranAt: number;
  status: 'ok' | 'drift' | 'skipped' | 'error';
  reason?: string;
  checked: number;
  drift: number;
  missing: number;
  error: number;
  items: FactItem[];
}

/** 采集命令的超时（本机）：采集是旁路，不能因为 pm2 卡住拖住整个进程 */
const LOCAL_CMD_TIMEOUT_MS = 15_000;

/**
 * 失败是不是「目标不存在」（ENOENT / ENOTDIR）。
 *
 * 区分它很重要：`No such file` 是**线上事实**（东西真的不在），不是采集机制故障。
 * 混进 `error` 会让运维按"采集中断了"去查，真正缺的东西反而没人补。
 */
export function isNotFound(e: unknown): boolean {
  const msg = (e as Error)?.message ?? String(e);
  return /No such file or directory|Not a directory/i.test(msg);
}

/** 命令执行的统一抽象：本机走 CommandService，远端走 SshExecService */
interface Runner {
  host: string;
  run(cmd: string): Promise<string>;
}

/**
 * 环境事实采集（Fact 层 v1，对应《console 建设方案》P0-6）。
 *
 * 做的事：把**线上真实态**采回来，与**期望态**比对，落 `deploy_fact_snapshots`。
 * 不做的事：不修、不改、不碰业务表 —— 漂移只告警（对齐设计里"采集只读"的约定）。
 *
 * 期望态来源（都是既有真相源，不新增第二套）：
 * - 前端模块版本 → `deploy_app_env_versions.currentVersion`
 * - 后端服务进程 / 端口 → `deploy_service_envs`（active）
 *
 * 采集通道：
 * - 本机（静态根无 sshTarget，典型是 dev）→ `CommandService.execAsync`
 * - 远端 → `SshExecService.run`（目标机解析的唯一入口，诊断 #15）
 */
@Injectable()
export class FactCollectService {
  private readonly logger = new Logger(FactCollectService.name);
  /** 正在采集的环境（手动触发与定时触发共用一把锁，避免同一环境并发采两轮） */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly cfg: ConfigService,
    private readonly ssh: SshExecService,
    private readonly command: CommandService,
    @InjectRepository(DeployAppEnvVersionEntity)
    private readonly versionRepo: Repository<DeployAppEnvVersionEntity>,
    @InjectRepository(DeployServiceEnvEntity)
    private readonly serviceEnvRepo: Repository<DeployServiceEnvEntity>,
    @InjectRepository(DeployFactSnapshotEntity)
    private readonly repo: Repository<DeployFactSnapshotEntity>,
  ) {}

  /**
   * 采集一个环境。
   * @throws ConflictException 该环境正在采集（手动连点 / 与定时撞车）
   */
  async collect(env: string, trigger: 'schedule' | 'manual' = 'schedule'): Promise<FactBatchReport> {
    if (!env) throw new Error('collect 需要 env');
    if (this.inFlight.has(env)) {
      throw new ConflictException(`环境 ${env} 正在采集中，请稍后再试`);
    }
    this.inFlight.add(env);
    try {
      return await this.doCollect(env, trigger);
    } finally {
      this.inFlight.delete(env);
    }
  }

  /** 环境是否在允许采集的清单里（默认只有 dev；prod 必须显式加入） */
  allowedEnvs(): string[] {
    const raw = this.cfg.get<string>('FACT_SNAPSHOT_ENVS') ?? 'dev';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private async doCollect(env: string, trigger: 'schedule' | 'manual'): Promise<FactBatchReport> {
    const batchId = crypto.randomUUID();
    const ranAt = Date.now();
    const target = resolveStaticTarget(
      env,
      (k) => this.cfg.get<string>(k),
      this.cfg.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace(),
    );
    const runner: Runner = target.sshTarget
      ? { host: target.sshTarget, run: (cmd) => this.ssh.run(env, cmd, `fact:${env}`) }
      : {
          host: 'local',
          run: async (cmd) => {
            const r = await this.command.execAsync(
              cmd,
              this.cfg.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace(),
              {},
              LOCAL_CMD_TIMEOUT_MS,
            );
            if (!r.ok) throw new Error(r.stderr?.trim() || r.stdout?.trim() || '本机命令执行失败');
            return r.stdout ?? '';
          },
        };

    const items: FactItem[] = [];

    // ① 前端模块：版本指针 + 版本目录产物
    const versions = await this.versionRepo.find({ where: { envId: env } });
    for (const v of versions) {
      const rel = envArtifactsRel(v.appKey, env);
      const pointerPath = `${target.root}/${rel}/index.js`;
      const dir = v.currentVersion ? `${target.root}/${rel}/${v.currentVersion}` : '';
      try {
        const out = await runner.run(cmdReadFile(pointerPath));
        items.push(
          this.mk('version', v.appKey, v.currentVersion ?? null, parsePointerCommit(out), null),
        );
      } catch (e) {
        items.push(
          isNotFound(e)
            ? await this.pointerAbsent(v.appKey, v.currentVersion ?? null, pointerPath, dir, runner)
            : this.failed('version', v.appKey, v.currentVersion ?? null, e),
        );
      }

      // 目录：只看「平台登记的版本」产物还在不在 —— 指针指错由上面的 version 事实表达
      if (v.currentVersion) {
        const dir = `${target.root}/${rel}/${v.currentVersion}`;
        try {
          const n = parseEntryCount(await runner.run(cmdCountEntries(dir)));
          items.push({
            kind: 'dir',
            targetKey: v.appKey,
            expected: '非空',
            actual: n == null ? null : `${n} 个条目`,
            status: n == null ? 'missing' : n > 0 ? 'ok' : 'missing',
            detail: { path: dir, entries: n },
          });
        } catch (e) {
          items.push(this.failed('dir', v.appKey, '非空', e, { path: dir }));
        }
      }
    }

    // ② 后端服务：pm2 进程 + 监听端口
    const svcEnvs = await this.serviceEnvRepo.find({ where: { envId: env, status: 'active' } });
    if (svcEnvs.length) {
      let procs: ReturnType<typeof parsePm2Processes> | null = null;
      let procError: string | null = null;
      try {
        procs = parsePm2Processes(await runner.run(cmdPm2List()));
      } catch (e) {
        procError = (e as Error).message;
      }
      for (const s of svcEnvs) {
        const name = s.pm2Name || s.serviceKey;
        if (procError) {
          items.push({
            kind: 'process',
            targetKey: s.serviceKey,
            expected: 'online',
            actual: null,
            status: 'error',
            detail: { pm2Name: name, reason: procError },
          });
          continue;
        }
        const p = (procs ?? []).find((x) => x.name === name);
        items.push(
          this.mk('process', s.serviceKey, 'online', p?.status ?? null, {
            pm2Name: name,
            pid: p?.pid ?? null,
            cwd: p?.cwd ?? null,
            restarts: p?.restarts ?? null,
          }),
        );
      }

      let ports: number[] | null = null;
      let portError: string | null = null;
      try {
        ports = parseListeningPorts(await runner.run(cmdListeningPorts()));
      } catch (e) {
        portError = (e as Error).message;
      }
      for (const s of svcEnvs.filter((x) => x.port)) {
        const port = s.port as number;
        if (portError) {
          items.push({
            kind: 'port',
            targetKey: s.serviceKey,
            expected: String(port),
            actual: null,
            status: 'error',
            detail: { reason: portError },
          });
          continue;
        }
        const listening = (ports ?? []).includes(port);
        items.push({
          kind: 'port',
          targetKey: s.serviceKey,
          expected: String(port),
          actual: listening ? 'listening' : 'not-listening',
          status: listening ? 'ok' : 'missing',
          detail: { port },
        });
      }
    }

    // ③ 落库（一批 save；失败整批记，不做部分成功）
    const rows = items.map((it) =>
      this.repo.create({
        batchId,
        envId: env,
        kind: it.kind,
        targetKey: it.targetKey,
        host: runner.host,
        expected: it.expected,
        actual: it.actual,
        status: it.status,
        detail: it.detail ?? null,
        trigger,
      }),
    );
    if (rows.length) await this.repo.save(rows);

    const drift = items.filter((i) => i.status === 'drift').length;
    const missing = items.filter((i) => i.status === 'missing').length;
    const error = items.filter((i) => i.status === 'error').length;
    const ok = items.filter((i) => i.status === 'ok').length;

    const report: FactBatchReport = {
      batchId,
      env,
      host: runner.host,
      ranAt,
      status: !items.length
        ? 'skipped'
        : drift + missing > 0
          ? 'drift'
          : ok === 0 && error > 0
            ? 'error'
            : 'ok',
      checked: items.length,
      drift,
      missing,
      error,
      items,
    };
    if (!items.length) {
      report.reason = `环境 ${env} 没有登记的期望态（无版本记录、无 active 服务），无可采集对象`;
    }

    const alerts = items.filter((i) => FACT_ALERT_STATUSES.includes(i.status));
    if (alerts.length) {
      this.logger.error(
        `事实巡检发现 ${alerts.length} 项需关注（env=${env}，host=${runner.host}）：` +
          alerts
            .slice(0, 6)
            .map((i) => `${i.kind}[${i.targetKey}] ${i.status}: 期望=${i.expected ?? '-'} 实际=${i.actual ?? '-'}`)
            .join('；'),
      );
    } else if (items.length) {
      this.logger.log(`事实巡检通过（env=${env}，${items.length} 项一致，host=${runner.host}）`);
    }
    return report;
  }

  /** 最近快照（按采集时间倒序；kind 可过滤） */
  async snapshots(env: string, kind?: string, limit = 200): Promise<DeployFactSnapshotEntity[]> {
    const n = Math.min(Math.max(Number(limit) || 200, 1), 500);
    return this.repo.find({
      where: { envId: env, ...(kind ? { kind: kind as FactKind } : {}) },
      order: { collectedAt: 'DESC' },
      take: n,
    });
  }

  /**
   * 最近一批快照的**全量信息**（含采集时间），无从数据时返回 null。
   *
   * 为什么要单独给这个入口：漂移清单 `drift()` 只返回告警项，消费者拿不到
   * 「最近一次是什么时候采的 / 到底采没采过」；而这两者恰恰决定了能不能把
   * "没有告警"读成"健康" —— **从未采集 ≠ 健康**（这是 #342 反复踩的 failure 模式：
   * 把"判不了"静默报成"没问题"）。
   *
   * 统一由这里提供最近批次，`drift()` 复用它做告警过滤，避免两处各写一个
   * 「找最近 batchId」的口径而漂移（参照 config-layer-backfill.spec 的双向比对做法）。
   */
  async latestBatch(
    env: string,
  ): Promise<{ batchId: string; collectedAt: number; items: DeployFactSnapshotEntity[] } | null> {
    const latest = await this.repo
      .createQueryBuilder('f')
      .select('f.batch_id', 'batchId')
      .where('f.env_id = :env', { env })
      .orderBy('f.collected_at', 'DESC')
      .limit(1)
      .getRawOne<{ batchId: string }>();
    if (!latest?.batchId) return null;
    const items = await this.repo.find({ where: { batchId: latest.batchId } });
    if (!items.length) return null;
    const collectedAt = Math.max(...items.map((i) => new Date(i.collectedAt).getTime()));
    return { batchId: latest.batchId, collectedAt, items };
  }

  /**
   * 最近一批的漂移清单。
   *
   * 只取**最近一批**而不是"历史上所有异常"：事实会随发布变化，
   * 把三小时前的漂移一起报出来等于噪音。
   */
  async drift(env: string): Promise<{ batchId: string | null; items: DeployFactSnapshotEntity[] }> {
    const batch = await this.latestBatch(env);
    if (!batch) return { batchId: null, items: [] };
    return {
      batchId: batch.batchId,
      items: batch.items.filter((i) => FACT_ALERT_STATUSES.includes(i.status)),
    };
  }

  private mk(
    kind: FactKind,
    targetKey: string,
    expected: string | null,
    actual: string | null,
    detail: Record<string, unknown> | null,
  ): FactItem {
    const v = classifyFact({ expected, actual });
    return { kind, targetKey, expected: v.expected, actual: v.actual, status: v.status, detail };
  }

  /**
   * 版本指针不存在时的判定 —— **不能一律报 missing**。
   *
   * 有些模块压根不用版本指针：dev 上 `shell` 的产物是 `index.html + assets + version.json`
   * （独立入口形态），从来不会生成 SystemJS 的 `index.js` 指针。把它报成漂移就是
   * **永久假告警**，真漂移会被它淹没 —— 这正是 v1 首跑暴露出来的口径问题。
   *
   * 所以「指针是否适用」本身也采成一个事实：探测版本目录里有没有 `index.html`：
   * - 有 → 指针不适用，标 `skipped`（不在告警清单内），版本目录是否完整由 `dir` 事实覆盖；
   * - 无 → 真的缺指针，标 `missing`；
   * - 探不到（命令失败）→ 保守按 `missing`：不能确认它没缺，就不该说它没问题。
   */
  private async pointerAbsent(
    targetKey: string,
    expected: string | null,
    pointerPath: string,
    dir: string,
    runner: Runner,
  ): Promise<FactItem> {
    let htmlCount: number | null = null;
    let probeError: string | null = null;
    if (dir) {
      try {
        htmlCount = parseEntryCount(await runner.run(cmdCountEntries(`${dir}/index.html`)));
      } catch (e) {
        probeError = (e as Error)?.message ?? String(e);
      }
    }
    const skipped = htmlCount != null && htmlCount > 0;
    return {
      kind: 'version',
      targetKey,
      expected,
      actual: null,
      status: skipped ? 'skipped' : 'missing',
      detail: {
        path: pointerPath,
        pointerApplicable: !skipped,
        reason: skipped
          ? '该模块产物为 index.html 入口形态，无 SystemJS 版本指针：跳过指针校验（版本目录完整性由 dir 事实覆盖）'
          : (probeError ?? '版本指针缺失'),
        probeError,
      },
    };
  }

  private failed(
    kind: FactKind,
    targetKey: string,
    expected: string | null,
    e: unknown,
    detail?: Record<string, unknown>,
  ): FactItem {
    const msg = (e as Error)?.message ?? String(e);
    // 命令被白名单拒绝是**代码问题**，不是线上问题：单独标出来，别混进"采集失败"
    const unsafe = e instanceof UnsafeFactCommandError;
    return {
      kind,
      targetKey,
      expected,
      actual: null,
      status: 'error',
      detail: { ...(detail ?? {}), reason: msg, unsafeCommand: unsafe },
    };
  }
}
