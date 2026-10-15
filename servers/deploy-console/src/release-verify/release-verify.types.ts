/**
 * `verify_release` 的类型契约（对应《aiops-console-target-architecture》§五 MCP 工具矩阵）。
 *
 * 定位：**L1 · 只读验证** —— 回答一个具体问题：
 *   **「这次发布，线上真的生效了吗？」**
 *
 * 与 `release_plan` 构成发布前后的一对：`plan` 管「发布前能不能发」，
 * 本工具管「发布后是不是真的发了」。
 *
 * ## 为什么不能只看流水线状态
 *
 * `pipeline.status = 'succeeded'` 只说明**脚本跑完了**，不说明东西真的生效了。
 * 经典失败模式全部落在这个缝里：
 *  - 切指针"成功"，但目标版本目录里是空的/旧的产物；
 *  - pm2 restart "执行"了，进程却还在跑旧代码；
 *  - 端口没起来，健康检查此刻才该说话。
 * 只看 job 状态会把这些全判成"发布成功"。
 *
 * ## 设计约束（红线）
 *
 *  - **只读。** 不写业务表、不切指针、不触发构建、不做任何自愈。
 *    事实采集走 `FactCollectService` 的 `persist:false`，**现采但不在快照表留痕** ——
 *    否则一次"看看发成功了没"就会改写巡检时间线。
 *    该约束由 `release-verify.service.spec.ts` 的只读断言守住。
 *  - **四态而非布尔**（比 `release_plan` 的三态多一个 `skipped`）：
 *    `pass` 通过 / `fail` 不通过 / `unknown` 判不了 / `skipped` 不适用。
 *    把 `skipped` 从 `unknown` 里分出来很重要：`unknown` 是**缺真相源**，
 *    `skipped` 是**确定不适用**（前端模块本就没有 pm2 进程）。
 *    混在一起会稀释 `unknown` 的语义，而它恰恰是我们最需要被看见的状态 ——
 *    "判不了"绝不能为了数字好看被归并进"通过"（#342 的教训）。
 *  - **核心项不给结论就不算通过**：任一 `core` 项为 `unknown` 时，
 *    整体 verdict 必须是 `unknown`，不能是 `verified`。
 *  - **未覆盖的检查要显式说出来**（见 {@link RELEASE_VERIFY_KNOWN_GAPS}）。
 */

/** 单项检查的状态 */
export type VerifyCheckStatus = 'pass' | 'fail' | 'unknown' | 'skipped';

/** 检查项的稳定标识（供下游按 key 稳定取用，禁止随意改名） */
export const VERIFY_CHECK_KEYS = {
  /** 流水线是否真的成功（给了 jobId 才有意义） */
  pipelineSucceeded: 'pipeline.succeeded',
  /** 线上版本指针是否等于目标版本 —— 直接回答「生效了吗」 */
  pointerMatches: 'pointer.matches',
  /** 目标版本目录是否有入口产物（指针对了但产物没落地也不算生效） */
  versionDirPresent: 'artifact.versionDir',
  /** pm2 进程是否活着（后端服务适用，前端模块 skipped） */
  processAlive: 'process.alive',
  /** 端口是否在监听（同上） */
  portListening: 'port.listening',
} as const;

export type VerifyCheckKey = (typeof VERIFY_CHECK_KEYS)[keyof typeof VERIFY_CHECK_KEYS];

/** 检查项的人读标题（**唯一定义处**，与 `safeCheck` 兜底路径共用） */
export const VERIFY_CHECK_TITLES: Record<VerifyCheckKey, string> = {
  [VERIFY_CHECK_KEYS.pipelineSucceeded]: '流水线执行成功',
  [VERIFY_CHECK_KEYS.pointerMatches]: '线上版本指针等于目标版本',
  [VERIFY_CHECK_KEYS.versionDirPresent]: '目标版本目录存在入口产物',
  [VERIFY_CHECK_KEYS.processAlive]: '服务进程在线',
  [VERIFY_CHECK_KEYS.portListening]: '服务端口监听中',
};

export interface VerifyCheckResult {
  key: VerifyCheckKey;
  /** 人读标题 */
  title: string;
  status: VerifyCheckStatus;
  /**
   * 是否**核心项**。核心项决定 verdict：
   *  - 任一核心项 `fail` → verdict `failed`
   *  - 任一核心项 `unknown` → verdict `unknown`（**不给结论**）
   * 非核心项只影响 `degraded`。
   */
  core: boolean;
  /** 期望值（没有期望态则 null） */
  expected: string | null;
  /** 实测值（没采到则 null） */
  actual: string | null;
  /** 结论依据（给人看的一句话，必须能指向具体数据） */
  detail: string;
  /** 证据明细（给机器/排障看） */
  evidence?: Record<string, unknown>;
}

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
 * 某条补齐后应从这里删除。
 */
export const RELEASE_VERIFY_KNOWN_GAPS: readonly KnownGap[] = [
  {
    key: 'http.probe',
    title: '业务 HTTP 健康探测（真实请求打过去看 200）',
    reason:
      'Fact 层 v1 只采 version/dir/process/port 四类事实，没有 HTTP 探测；' +
      '现有的 HttpProbeService 服务于服务健康检查，尚未接入事实层',
    coveredBy: '端口监听检查（process/port 能兜住"进程没了"，兜不住"进程在但内部报错"）',
  },
  {
    key: 'config.hash',
    title: '目标机关键配置 hash 与期望一致',
    reason: '目标机配置无真相源（依赖 P1 config-client）',
    coveredBy: null,
  },
];

/**
 * 总体结论。
 *
 * - `verified` 生效：所有核心项 pass（非核心项可 skipped）
 * - `failed`  没生效：任一核心项 fail
 * - `unknown` 判不了：核心项既非 pass 也非 fail（缺真相源 / 采集故障）
 * - `degraded` 生效但有瑕疵：核心项全 pass，但有非核心项 fail/unknown
 */
export type ReleaseVerifyVerdict = 'verified' | 'failed' | 'unknown' | 'degraded';

export interface ReleaseVerifyInput {
  /** 目标环境（envId，用户自建） */
  env: string;
  /** 模块 key */
  moduleKey: string;
  /** 目标版本；不传则取该环境当前线上指针作为期望（用于"确认现状"场景） */
  versionTag?: string;
  /**
   * 关联流水线 jobId。传了才会校验「流水线是否成功」；
   * 不传则只做事实比对（适用于流水线记录被清理 / 外部触发的发布）。
   */
  jobId?: string;
  /**
   * 严格模式：非核心项 fail 时是否也把 verdict 打成 `failed`。
   * 默认 false（降级为 `degraded`）—— 进程/端口对前端模块本就不适用，
   * 一刀切会让大量正常发布被误判为失败。
   */
  strict?: boolean;
}

/** 期望态的来源（决定了结论的可信度，必须回传给调用方） */
export type ExpectationSource = 'input' | 'current-pointer' | 'pipeline';

export interface ReleaseVerifyReport {
  /**
   * 验证 ID —— **入参指纹**（幂等）。
   * 同一份入参恒得同值；它标识"你要验证这件事"，不代表此刻事实仍成立。
   */
  verifyId: string;
  /**
   * 结论指纹 —— 检查结果的 hash。
   * 事实变了它就变，供调用方判断"两次验证之间线上是否动过"。
   */
  resultHash: string;
  verifiedAt: number;
  /** 恒为 true：本次验证未对系统做任何变更 */
  dryRun: true;
  input: {
    env: string;
    moduleKey: string;
    versionTag: string | null;
    jobId: string | null;
    strict: boolean;
  };
  expected: {
    version: string | null;
    source: ExpectationSource | null;
  };
  actual: {
    version: string | null;
    /** 目标版本目录下的条目数；null = 没采到 */
    entries: number | null;
    processes: number | null;
    ports: number | null;
  };
  checks: VerifyCheckResult[];
  verdict: ReleaseVerifyVerdict;
  /** 核心项失败标题（verdict=failed 的根因） */
  blockers: string[];
  /** 需注意但不挡路的结论（含所有 unknown / skipped 及其原因） */
  warnings: string[];
  knownGaps: readonly KnownGap[];
  /** 一句话结论（给 LLM / 日志用）：先说生效没生效，再说为什么 */
  summary: string;
}

/**
 * 构造一条检查结论。
 *
 * 走 helper 而非手写对象字面量：`title` 一律由 key 经 {@link VERIFY_CHECK_TITLES} 推导，
 * **不可能写错，也不可能和 `safeCheck` 的兜底路径给出两个说法**
 * （沿用 `release-plan.types.invariant` 的做法）。
 */
export function verifyCheck(spec: Omit<VerifyCheckResult, 'title'>): VerifyCheckResult {
  return { ...spec, title: VERIFY_CHECK_TITLES[spec.key] };
}
