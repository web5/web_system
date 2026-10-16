import { Injectable, Logger } from '@nestjs/common';
import { ModuleRegistryService } from '../module-registry/module-registry.service';
import { ReleaseRegistryService } from '../registry/release-registry.service';
import { PipelineService } from '../pipeline/pipeline.service';
import { FactCollectService, FactBatchReport } from '../fact/fact-collect.service';
import { toCommitId } from '../pipeline/release-paths';
import {
  ReleaseVerifyInput,
  ReleaseVerifyReport,
  VerifyCheckResult,
  VerifyCheckKey,
  VERIFY_CHECK_KEYS,
  RELEASE_VERIFY_KNOWN_GAPS,
  ExpectationSource,
  verifyCheck,
} from './release-verify.types';
import {
  buildVerifyId,
  buildResultHash,
  buildSummary,
  gradeVerdict,
  compareCheck,
  skippedCheck,
  unknownCheck,
  normalizeInput,
} from './release-verify-rules';

/** 前端（微前端产物）与后端（常驻服务）走不同的生效判据 */
const FRONTEND_TYPES = new Set(['micro-frontend']);

/**
 * `verify_release` —— L1 只读发布后验证（《aiops-console-target-architecture》§五）。
 *
 * **回答一个问题：这次发布，线上真的生效了吗？**
 *
 * ## 硬约束：只读
 *
 * 不得调用任何写方法（save / create / update / delete / setPointer / submit / restart …）。
 * 这不是洁癖 —— 它是 L1 工具的定义：Agent 拿它的能力是"看一眼发成功没"，
 * 不是"顺便帮你修一下"。失败时最容易顺手自愈，红线因此在
 * `release-verify.service.spec.ts` 里连"全部检查失败"的场景一起断言。
 *
 * ## 事实是"现采"的，但不落库
 *
 * 验证必须基于**此刻**的事实：读几小时前的快照等于没验。
 * 所以这里调 `facts.collect(env, 'manual', { persist: false })` ——
 * 采集跑的都是 cat / ls / `pm2 jlist` 这类读命令，本身无副作用；
 * 只有"写快照表"是写操作，把它关掉即可。否则一次"看看发成功了没"
 * 就会改写巡检时间线，让定时巡检的节奏失真。
 *
 * ## 判据全部复用既有真相源，不新增第二套
 *
 * | 检查 | 真相源 |
 * |---|---|
 * | 流水线成功 | `PipelineService.get` |
 * | 指针 == 目标版本 | Fact 层 `version` 事实（读指针文件内容解析） |
 * | 版本目录有产物 | Fact 层 `dir` 事实 |
 * | 进程在线 | Fact 层 `process` 事实 |
 * | 端口监听 | Fact 层 `port` 事实 |
 */
@Injectable()
export class ReleaseVerifyService {
  private readonly logger = new Logger(ReleaseVerifyService.name);

  constructor(
    private readonly modules: ModuleRegistryService,
    private readonly registry: ReleaseRegistryService,
    private readonly pipelines: PipelineService,
    private readonly facts: FactCollectService,
  ) {}

  /**
   * 验证一次发布是否生效。
   *
   * @throws 入参非法（空 env / 空 moduleKey）或 jobId 指向不存在的流水线时抛错。
   *         **事实采不到不抛错** —— 那正是 `unknown` 要表达的东西。
   */
  async verify(input: ReleaseVerifyInput): Promise<ReleaseVerifyReport> {
    const norm = normalizeInput(input);
    if (!norm.env) throw new Error('verify_release 需要 env');
    if (!norm.moduleKey) throw new Error('verify_release 需要 moduleKey');

    // 模块类型决定走哪套判据；模块不存在会让后续所有检查失去意义，直接抛错
    // 由调用方（controller）转成 404，而不是返回一份"全是 unknown"的报告。
    const mod = await this.modules.get(norm.moduleKey);
    const isFrontend = FRONTEND_TYPES.has(String(mod.type));

    // 期望版本：入参优先；其次流水线记录；都没有则回落当前线上指针（"确认现状"场景）
    const expectation = await this.resolveExpectation(norm);

    // 现采事实（不落库）
    const batch = await this.facts.collect(norm.env, 'manual', { persist: false });

    const checks: VerifyCheckResult[] = [
      await this.safe(VERIFY_CHECK_KEYS.pipelineSucceeded, true, () =>
        this.checkPipeline(norm.jobId),
      ),
      await this.safe(VERIFY_CHECK_KEYS.pointerMatches, true, () =>
        this.checkPointer(norm.moduleKey, expectation.version, batch),
      ),
      await this.safe(VERIFY_CHECK_KEYS.versionDirPresent, isFrontend, () =>
        this.checkVersionDir(norm.moduleKey, batch, isFrontend),
      ),
      await this.safe(VERIFY_CHECK_KEYS.processAlive, false, () =>
        this.checkProcess(norm.moduleKey, batch, isFrontend),
      ),
      await this.safe(VERIFY_CHECK_KEYS.portListening, false, () =>
        this.checkPort(norm.moduleKey, batch, isFrontend),
      ),
    ];

    // 「一项都判不了时绝不声称 verified」由 gradeVerdict 负责：
    // 核心项全 skipped 说明该模块在此环境无登记期望态，
    // 此时"没报警"是真空，不是健康。
    const { verdict, blockers, warnings } = gradeVerdict({
      checks,
      strict: norm.strict,
    });

    const actualVersion = pickActual(batch, 'version', norm.moduleKey);
    const report: ReleaseVerifyReport = {
      verifyId: buildVerifyId(input),
      resultHash: '',
      verifiedAt: Date.now(),
      dryRun: true,
      input: {
        env: norm.env,
        moduleKey: norm.moduleKey,
        versionTag: norm.versionTag,
        jobId: norm.jobId,
        strict: norm.strict,
      },
      expected: expectation,
      actual: {
        version: actualVersion,
        entries: parseEntries(pickActual(batch, 'dir', norm.moduleKey)),
        processes: countStatus(batch, 'process'),
        ports: countStatus(batch, 'port'),
      },
      checks,
      verdict,
      blockers,
      warnings,
      knownGaps: RELEASE_VERIFY_KNOWN_GAPS,
      summary: '',
    };

    report.resultHash = buildResultHash({
      expected: report.expected,
      actual: report.actual,
      checks: report.checks,
    });
    report.summary = buildSummary({
      env: norm.env,
      moduleKey: norm.moduleKey,
      version: expectation.version,
      verdict,
      blockers,
      unknowns: checks.filter((c) => c.status === 'unknown').map((c) => c.title),
      skipped: checks.filter((c) => c.status === 'skipped').map((c) => c.title),
    });

    this.logger.log(
      `verify_release: ${report.summary} (verifyId=${report.verifyId}, result=${report.resultHash})`,
    );
    return report;
  }

  // ── 期望态 ──

  /**
   * 期望版本从哪来，以及**为什么是这个优先级**。
   *
   *  1. 入参 `versionTag` —— 调用方明确说"我要验证发到了 X"
   *  2. 流水线记录 —— 只给了 jobId 时，以该流水线实际发布版本为准
   *  3. 当前线上指针 —— 都没给，则退化为"确认现状"，仍有用
   *     （例如人工改过指针后确认线上是什么），但要在 detail 里说清
   *
   * 三者语义不同，来源必须回传给调用方：拿"现状"当"目标"验证出来的一律
   * 恒为 pass，若不标明来源，这份报告就成了永远绿灯的摆设。
   */
  private async resolveExpectation(norm: {
    env: string;
    moduleKey: string;
    versionTag: string | null;
    jobId: string | null;
  }): Promise<{ version: string | null; source: ExpectationSource | null }> {
    if (norm.versionTag) return { version: norm.versionTag, source: 'input' };

    if (norm.jobId) {
      try {
        const p = await this.pipelines.get(norm.jobId);
        const v = toCommitId(String(p?.versionTag ?? '')) ?? null;
        if (v) return { version: v, source: 'pipeline' };
      } catch {
        // 流水线查不到由 checkPipeline 那条检查表达；这里只是取不到期望版本
      }
    }

    const current = (await this.registry.currentVersion(norm.env, norm.moduleKey)) ?? null;
    return {
      version: current ? (toCommitId(current) ?? current) : null,
      source: current ? 'current-pointer' : null,
    };
  }

  // ── 检查项 ──

  /** 流水线是否真的成功（未给 jobId → skipped，不是 unknown：跳过是确定的选择） */
  private async checkPipeline(jobId: string | null): Promise<VerifyCheckResult> {
    if (!jobId) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.pipelineSucceeded,
        '未提供 jobId，跳过流水线状态校验，仅做线上事实比对',
      );
    }
    const p = await this.pipelines.get(jobId);
    if (String(p.status) !== 'succeeded') {
      return verifyCheck({
        key: VERIFY_CHECK_KEYS.pipelineSucceeded,
        status: 'fail',
        core: true,
        expected: 'succeeded',
        actual: String(p.status),
        detail: `流水线 ${jobId} 当前状态为 ${p.status}，未成功完成，无法认为本次发布已生效`,
        evidence: { jobId, status: String(p.status) },
      });
    }
    return verifyCheck({
      key: VERIFY_CHECK_KEYS.pipelineSucceeded,
      status: 'pass',
      core: true,
      expected: 'succeeded',
      actual: 'succeeded',
      detail: `流水线 ${jobId} 已成功完成`,
      evidence: { jobId },
    });
  }

  /**
   * 核心检查：线上版本指针是否等于目标版本。
   *
   * 这是"生效"的直接证据 —— 读的是指针文件真实内容解析出的 commit，
   * 不是数据库里"我们认为应该是什么"。
   */
  private async checkPointer(
    moduleKey: string,
    expected: string | null,
    batch: FactBatchReport,
  ): Promise<VerifyCheckResult> {
    const item = batch.items.find((i) => i.kind === 'version' && i.targetKey === moduleKey);
    if (!item) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.pointerMatches,
        `环境内未登记 ${moduleKey} 的版本记录，无版本指针可比对` +
          '（后端 legacy 服务只写 deploy_deployments 时会出现这种情况）',
      );
    }
    if (item.status === 'error') {
      // 采集故障：不能读作"没生效"
      return unknownCheck(
        VERIFY_CHECK_KEYS.pointerMatches,
        true,
        new Error(String((item.detail as Record<string, unknown>)?.reason ?? '版本指针采集失败')),
      );
    }
    return compareCheck({
      key: VERIFY_CHECK_KEYS.pointerMatches,
      core: true,
      expected,
      actual: item.actual ?? null,
      passDetail: `线上指针 ${item.actual} 与目标版本一致（host=${batch.host}）`,
      failDetail:
        `线上指针为 ${item.actual ?? '空'}，但目标版本是 ${expected ?? '未指定'}` +
        ' —— 切指针未生效或已被覆盖（host=' +
        batch.host +
        '）',
      evidence: { host: batch.host, batchId: batch.batchId },
    });
  }

  /** 目标版本目录是否有入口产物（仅前端产物目录适用） */
  private async checkVersionDir(
    moduleKey: string,
    batch: FactBatchReport,
    isFrontend: boolean,
  ): Promise<VerifyCheckResult> {
    if (!isFrontend) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.versionDirPresent,
        `模块 ${moduleKey} 非微前端产物（类型不适用），跳过版本目录检查`,
      );
    }
    const item = batch.items.find((i) => i.kind === 'dir' && i.targetKey === moduleKey);
    if (!item) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.versionDirPresent,
        `环境内未登记 ${moduleKey} 的版本记录，无版本目录可查`,
      );
    }
    if (item.status === 'error') {
      return unknownCheck(
        VERIFY_CHECK_KEYS.versionDirPresent,
        isFrontend,
        new Error(String((item.detail as Record<string, unknown>)?.reason ?? '版本目录采集失败')),
      );
    }
    const ok = item.status === 'ok';
    return verifyCheck({
      key: VERIFY_CHECK_KEYS.versionDirPresent,
      status: ok ? 'pass' : 'fail',
      core: isFrontend,
      expected: item.expected ?? null,
      actual: item.actual ?? null,
      detail: ok
        ? `版本目录非空（${item.actual}，host=${batch.host}）`
        : `版本目录为空或不存在（${String(
            (item.detail as Record<string, unknown>)?.path ?? '-',
          )}）—— 指针虽已切换，实际产物未落地`,
      evidence: { host: batch.host, path: (item.detail as Record<string, unknown>)?.path ?? null },
    });
  }

  /** 服务进程是否在线（仅后端服务适用；前端模块无进程 → skipped） */
  private async checkProcess(
    moduleKey: string,
    batch: FactBatchReport,
    isFrontend: boolean,
  ): Promise<VerifyCheckResult> {
    if (isFrontend) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.processAlive,
        `模块 ${moduleKey} 为微前端产物，无常驻进程，跳过进程检查`,
      );
    }
    const item = batch.items.find((i) => i.kind === 'process' && i.targetKey === moduleKey);
    if (!item) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.processAlive,
        `环境内 ${moduleKey} 无 active 服务登记，跳过进程检查`,
      );
    }
    if (item.status === 'error') {
      return unknownCheck(
        VERIFY_CHECK_KEYS.processAlive,
        false,
        new Error(String((item.detail as Record<string, unknown>)?.reason ?? '进程采集失败')),
      );
    }
    const online = item.status === 'ok';
    return verifyCheck({
      key: VERIFY_CHECK_KEYS.processAlive,
      status: online ? 'pass' : 'fail',
      core: false,
      expected: item.expected ?? null,
      actual: item.actual ?? null,
      detail: online
        ? `进程 ${moduleKey} 在线（${item.actual}，host=${batch.host}）`
        : `进程 ${moduleKey} 不在线（实际=${item.actual ?? '未找到'}）—— 服务可能未拉起或已退出`,
      evidence: { host: batch.host },
    });
  }

  /** 端口是否在监听（仅后端服务适用） */
  private async checkPort(
    moduleKey: string,
    batch: FactBatchReport,
    isFrontend: boolean,
  ): Promise<VerifyCheckResult> {
    if (isFrontend) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.portListening,
        `模块 ${moduleKey} 为微前端产物，不监听端口，跳过端口检查`,
      );
    }
    const item = batch.items.find((i) => i.kind === 'port' && i.targetKey === moduleKey);
    if (!item) {
      return skippedCheck(
        VERIFY_CHECK_KEYS.portListening,
        `环境内 ${moduleKey} 无 active 服务登记或端口未登记，跳过端口检查`,
      );
    }
    if (item.status === 'error') {
      return unknownCheck(
        VERIFY_CHECK_KEYS.portListening,
        false,
        new Error(String((item.detail as Record<string, unknown>)?.reason ?? '端口采集失败')),
    );
    }
    const listening = item.status === 'ok';
    return verifyCheck({
      key: VERIFY_CHECK_KEYS.portListening,
      status: listening ? 'pass' : 'fail',
      core: false,
      expected: item.expected ?? null,
      actual: item.actual ?? null,
      detail: listening
        ? `端口 ${item.expected} 正在监听（host=${batch.host}）`
        : `端口 ${item.expected} 未在监听（实际=${item.actual ?? '未监听'}）—— 服务可能起来了但没绑上端口`,
      evidence: { host: batch.host, port: item.expected },
    });
  }

  // ── 兜底 ──

  /** 单项检查异常 → unknown（非 fail）。详见 {@link unknownCheck} 的说明 */
  private async safe(
    key: VerifyCheckKey,
    core: boolean,
    fn: () => Promise<VerifyCheckResult>,
  ): Promise<VerifyCheckResult> {
    try {
      return await fn();
    } catch (e) {
      return unknownCheck(key, core, e);
    }
  }
}

// ── 事实项抽取（纯函数，便于单测） ──

type FactItemLike = { kind: string; targetKey: string; actual?: string | null; status?: string };

/** 取某模块某类事实的实测值；没采到返回 null（不是空串） */
function pickActual(batch: FactBatchReport, kind: string, targetKey: string): string | null {
  const it = (batch.items as FactItemLike[]).find(
    (i) => i.kind === kind && i.targetKey === targetKey,
  );
  if (!it) return null;
  const v = it.actual;
  return v == null || v === '' ? null : String(v);
}

/** 某类事实里状态为 ok 的条数（用于"进程/端口整体情况"的概览） */
function countStatus(batch: FactBatchReport, kind: string): number | null {
  const rows = (batch.items as FactItemLike[]).filter((i) => i.kind === kind);
  if (!rows.length) return null;
  return rows.filter((i) => i.status === 'ok').length;
}

/** `"N 个条目"` → N；解析不出来返回 null（不猜 0，0 是"空目录"这一确定事实） */
function parseEntries(actual: string | null): number | null {
  if (actual == null) return null;
  const m = /(\d+)/.exec(actual);
  return m ? Number(m[1]) : null;
}
