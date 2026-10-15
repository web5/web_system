/**
 * `release_plan` 的类型契约（对应《aiops-console-target-architecture》§五 MCP 工具矩阵）。
 *
 * 定位：**L1 · 可提案（plan）** —— 只读 dry-run。它回答四件事：
 *   ① 这次发布会动什么（影响面）
 *   ② 现在能不能发（不变量前置检查）
 *   ③ 风险有多大（风险等级）
 *   ④ 要不要人审批
 *
 * 设计约束（红线）：
 *  - **不写任何库、不改任何指针、不触发任何构建** —— 只做查询与判定
 *  - **状态三态而非布尔**：`pass / fail / unknown`。
 *    `unknown` 是**没有真相源 / 判定不了**，绝不能为了"好看"把它归并进 `pass`。
 *    背景（#342 的教训）：把「判定不了」静默报成「没问题」，比直接报错更坏 ——
 *    它让人基于一个从未验证过的前提去做发布决策。
 *  - **未覆盖的不变量要显式说出来**（见 {@link RELEASE_PLAN_KNOWN_GAPS}），
 *    不做"看起来通过了"的假检查。
 */

/** 发布模式（与流水线 PipelineMode 对齐，此处不引实体以免类型循环） */
export type ReleasePlanMode = 'direct' | 'grayscale';

export interface ReleasePlanInput {
  /** 目标环境（envId，用户自建） */
  env: string;
  /** 模块 key */
  moduleKey: string;
  /** 目标版本（纯 commit 或 `namespace/commit` 引用）；不传 = 由流水线现场构建 */
  versionTag?: string;
  mode?: ReleasePlanMode;
  /** 灰度规则（mode=grayscale 时必填，与流水线提交同语义） */
  grayscaleRule?: string;
}

/** 不变量判定结果的状态 */
export type InvariantStatus = 'pass' | 'fail' | 'unknown';

/** 不变量的稳定标识（供下游按 key 稳定取用，禁止随意改名） */
export const INVARIANT_KEYS = {
  /** 模块是否在册 */
  moduleRegistered: 'module.registered',
  /** 目标版本产物是否存在 */
  targetArtifact: 'artifact.target',
  /** 发布锁是否空闲 */
  releaseLock: 'lock.free',
  /** 同「模块 × 环境」是否有正在运行的流水线 */
  noRunningPipeline: 'pipeline.noRunning',
  /** 目标环境当前是否健康（无已知漂移） */
  envHealthy: 'env.healthy',
  /** 回滚点是否存在 */
  rollbackPoint: 'rollback.point',
  /** 是否已有待审批的发布单（重复提交会被 409） */
  noPendingApproval: 'approval.noPending',
} as const;

export type InvariantKey = (typeof INVARIANT_KEYS)[keyof typeof INVARIANT_KEYS];

/**
 * 不变量的人读标题（**唯一定义处**）。
 *
 * 检查实现与异常兜底路径都从这里取 —— 只有一份，就不会出现
 * "正常返回时叫 A、异常兜底时叫 B" 这种让人对不上的情况。
 */
export const INVARIANT_TITLES: Record<InvariantKey, string> = {
  [INVARIANT_KEYS.moduleRegistered]: '模块已登记',
  [INVARIANT_KEYS.targetArtifact]: '目标版本产物存在',
  [INVARIANT_KEYS.releaseLock]: '无并发发布锁',
  [INVARIANT_KEYS.noRunningPipeline]: '无并发运行的流水线',
  [INVARIANT_KEYS.envHealthy]: '目标环境无已知漂移',
  [INVARIANT_KEYS.rollbackPoint]: '存在可回滚版本',
  [INVARIANT_KEYS.noPendingApproval]: '无待决审批单',
};

export interface InvariantResult {
  key: InvariantKey;
  /** 人读标题 */
  title: string;
  status: InvariantStatus;
  /**
   * 该项不通过是否**挡住**发布。
   * `fail && blocking` → 提交应当被拒绝（见 {@link ReleasePlan.blockers}）。
   * `unknown` 一律不 blocking —— 判定不了不构成拒绝理由，但会抬升风险等级。
   */
  blocking: boolean;
  /** 结论依据（给人看的一句话，必须能指向具体数据） */
  detail: string;
  /** 证据明细（给机器/排障看） */
  evidence?: Record<string, unknown>;
}

/**
 * 设计里有、但当前架构**给不出真相**的不变量。
 *
 * 为什么要单独列出来而不是默默跳过：调用方（尤其 LLM Agent）会默认
 * "返回里没有报警 = 检查通过"。不声明缺口等于制造假绿灯。
 */
export interface KnownGap {
  key: string;
  title: string;
  /** 为什么现在判不了 */
  reason: string;
  /** 缺口期间由什么手段兜底（没有就写 null，不要编造） */
  coveredBy: string | null;
}

/**
 * 已知缺口清单。
 *
 * ⚠️ 每条都是**真的没做**，不是"已经做了但没列出来"。
 * 某条补齐后应从这里删除，并在下方 NOTES 记录补齐版本。
 */
export const RELEASE_PLAN_KNOWN_GAPS: readonly KnownGap[] = [
  {
    key: 'script.hash',
    title: '④ 脚本 hash 与脚本库一致',
    reason:
      '当前流水线脚本内联存于 deploy_pipeline_step_command.actions.code，' +
      '既没有 scriptRef 也没有独立的脚本库，无从比对 hash；' +
      '该形态要等 Phase P2「脚本 Assets 化」（SCRIPT REF 落地）才具备判定条件',
    coveredBy: 'scripts/pipeline-lint（CI 阶段静态检查 bash -n 与 env 完备性）',
  },
  {
    key: 'config.hash',
    title: '目标机关键配置 hash 一致',
    reason:
      '目标机服务目录映射没有真相源（Fact 层的配置采集尚未实现），无法定位待校验的配置文件',
    coveredBy: null,
  },
];

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * 构造一条不变量结论。
 *
 * 走 helper 而非手写对象字面量：`title` 一律由 key 经 {@link INVARIANT_TITLES} 推导，
 * **不可能写错，也不可能和 `safeCheck` 的兜底路径给出两个说法**。
 */
export function invariant(spec: Omit<InvariantResult, 'title'>): InvariantResult {
  return { ...spec, title: INVARIANT_TITLES[spec.key] };
}

/** 影响面：这次发布动的是什么 */
export interface ReleaseImpact {
  /** 当前线上版本（指针），没有记录则 null */
  currentVersion: string | null;
  /** 目标版本（归一化后的纯 commit），未提供则 null */
  targetVersion: string | null;
  /**
   * 版本变化方向。
   * `unknown` = 缺少一侧数据（首次发布 / 未传 versionTag），**不代表有变化**。
   */
  versionChange: 'same' | 'upgrade' | 'unknown';
  /** 模块类型（micro-frontend / service / …） */
  moduleType: string | null;
  /** 发布模式 */
  mode: ReleasePlanMode;
  /** 该环境静态伺服根（`/data/...` 形式，仅用于人读与排障） */
  staticRoot: string;
  /** 静态根所在机器：`local` = console 本机，否则 `user@host` */
  staticTarget: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** 累加评分（只服务于"哪些更值得担心"的排序，绝对值无跨版本可比性） */
  score: number;
  /** 逐条加分/定级理由（每条都要能追溯到具体判定） */
  reasons: string[];
}

/** `release_plan` 的完整返回 */
export interface ReleasePlan {
  /**
   * 计划 ID —— **输入指纹**（幂等）。
   *
   * 同一份入参在任何时刻、任何实例上都得到同样的 planId；它标识的是
   * "你要做这件事"，**不代表当时的事实仍然成立**。事实是否变了看 {@link evidenceHash}。
   */
  planId: string;
  /**
   * 结论指纹 —— 检查结果的 hash。
   *
   * 事实漂移后它会变：下游 `release_submit` 拿 planId 提交时应当比对它，
   * 不一致说明「提案时的事实 ≠ 提交时的事实」，要求重做 plan。
   */
  evidenceHash: string;
  createdAt: number;
  /** 恒为 true：本结果是 dry-run 产物，未对系统做任何变更 */
  dryRun: true;
  input: {
    env: string;
    moduleKey: string;
    versionTag: string | null;
    mode: ReleasePlanMode;
  };
  impact: ReleaseImpact;
  invariants: InvariantResult[];
  risk: RiskAssessment;
  /** 提交时是否需要审批（取负极：环境规则 + 模板策略） */
  requiresApproval: boolean;
  /** 为什么需要/不需要审批 */
  approvalReason: string;
  /** 挡住发布的不变量标题清单（blocking && fail）；非空 = 不该提交 */
  blockers: string[];
  /** 需要注意但不挡路的结论（含所有 `unknown`） */
  warnings: string[];
  /** 未覆盖的不变量（表白到底是什么没检查） */
  knownGaps: readonly KnownGap[];
  /** 一句话结论（给 LLM / 日志用） */
  summary: string;
}
