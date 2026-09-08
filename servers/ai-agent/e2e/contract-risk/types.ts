/**
 * contract-risk Agent 端到端评测 · 公共类型定义。
 *
 * 位置：servers/ai-agent/e2e/contract-risk/types.ts
 * 只放类型与常量枚举，纯 TS、无运行依赖。
 * 评测语义（判定规则）以 README.md 为准；每个可选字段都带"默认值 / 如何关闭"注释，
 * 方便后续单独调某个样本的验证强度。
 */

/** 报告 scene 中文标签（与 contract-risk.agent.ts systemPrompt 约定保持一致） */
export const SCENE_LABELS = [
  '消费贷款',
  '购车贷款',
  '购车融资租赁',
  '医疗保险',
  '车险',
  '租房',
  '其他',
] as const;
export type SceneLabel = (typeof SCENE_LABELS)[number];

/** 风险信号等级（与报告 signals[].level 一致；danger > warn > ok） */
export type SignalLevel = 'danger' | 'warn' | 'ok';

/** 等级相对强弱（用于 minLevel / maxSignalLevel 判定） */
export const LEVEL_RANK: Record<SignalLevel, number> = { ok: 0, warn: 1, danger: 2 };

/**
 * 一份 golden 样本的 ground truth 注解。
 * 一经固定不可修改（改输入 = 换基准 = 基线重置，见 README 防漂移）。
 * 除 expectSignalIds 外，其余均为【可选断言】——默认关闭或不卡级别，
 * 想对某个样本加强/放松验证，只改这一份样本的注解即可。
 */
export interface EvalSampleTruth {
  /**
   * 必须出现的信号 id（对应 report.signals[].id）。
   * 语义 = "下集断言"：agent 额外多报不算错；缺一个判 FAIL。
   * 设为 [] 表示不做"必须出现"约束。
   */
  expectSignalIds: string[];

  /**
   * 【可选·决策 A：信号最低级别】期望信号出现且级别 ≥ minLevel。
   * 例：{ 'usury-interest': 'danger' } = 该信号必须出现且必须是 danger。
   * 默认不填 = 只要求 id 出现，不卡级别（适合想把基线做稳、先只看漏报的阶段）。
   * 关闭/降级：删掉对应条目，或把 'danger' 改为 'warn'。
   */
  expectSignalLevels?: Record<string, SignalLevel>;

  /**
   * 【可选·决策 B 延伸：信号最高级别】整份报告不允许出现高于此级别的信号。
   * 例：maxSignalLevel: 'ok' = 不允许出现 warn/danger（干净合同对照组的"不乱报"断言）。
   * 默认不填 = 不限级别。
   */
  maxSignalLevel?: SignalLevel;

  /**
   * 【可选·决策 E：通用权益下限】报告 rights 至少 N 条。
   * 默认值 1（推荐：即使干净合同也应给 1 条通用权益，如 7 天冷静期）。
   * 关闭：显式设 0。
   */
  rightsMin?: number;

  /**
   * 【可选】是否要求 rights 与 signals 严格一一对应（id 相同）。
   * 默认 false —— 因为"通用权益"（如冷静期）本就没有对应信号，强制一一对应会让干净样本必挂。
   * 需要收紧时对该样本设 true。
   */
  requireRightsMirror?: boolean;

  /** 贷款类样本期望 IRR 对账参数（非贷款样本省略）。期望值由 analyzeLoan 在判定时现算，不手拍 */
  loan?: {
    principal: number;
    upfrontFee: number;
    periods: number;
    monthlyPayment: number;
  };

  /**
   * 合规红线禁词：conclusion / signalTitle / plainText / actions 等任一文本命中即判违规。
   * 语义 = "整段文本不得出现"。可传 [] 临时关闭红线扫描。
   */
  redlineForbidden: string[];
}

/**
 * 一份 golden 样本（任务卡固定输入）。
 * 除固定字段外均为【可选】的链路级断言（工具是否被真实调用 / 调用顺序）。
 * 合同正文存在 fixtures/texts/<id>.txt（与 TS 解耦，便于单独审阅/修改），
 * 由 run-eval 的 loadManifest 读入并填充 contractText。
 */
export interface EvalSample {
  id: string;
  /** 合同类型标签（期望 scene，report.scene 应与之一致） */
  scene: SceneLabel;
  /** 场景域：'loan'（贷款类，走 IRR 对账）| 'insurance' | 'rental' | 'other' */
  domain: 'loan' | 'insurance' | 'rental' | 'other';
  /** 是否 OCR 噪声样本（期望触发 contract-cleaner） */
  ocrNoisy?: boolean;
  /** 原始合同文本（唯一 userInput；manifest 声明阶段可缺省，loader 按 id 从 texts/ 读入填充） */
  contractText?: string;
  truth: EvalSampleTruth;

  /**
   * 【可选·决策 D：工具调用包含】本次 run 的工具调用序列必须包含这些工具（无序）。
   * 例：['contract-irr'] = 必须真实调过 IRR 工具（防 agent 编数）。
   * 默认不填 = 不校验工具包含。
   */
  expectToolCalls?: string[];

  /**
   * 【可选·决策 D：工具调用顺序】调用序列需按此相对顺序出现（子序列匹配，允许中间插别的工具）。
   * 例：['contract-cleaner', 'contract-rule'] = 清洗必须在判定之前（OCR 样本链路断言）。
   * 默认不填 = 不校验顺序。
   */
  expectToolOrder?: string[];

  /**
   * 是否要求本次 run 至少发生过一次工具调用。
   * 默认 true（合同风险分析必然要调 contract-rule，0 次调用直接判 FAIL）。
   * 关闭：显式设 false（如未来加入纯文本解释型样本）。
   */
  requireToolUse?: boolean;
}

/** 结构层判定结果（字段全不全，机器判定） */
export interface FieldCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

/** 数值层判定结果（对账，机器判定） */
export interface NumberCheck {
  name: string;
  /** 期望值（由 analyzeLoan 在判定时现算） */
  expected: number;
  /** agent 报告中出现的值 */
  actual?: number;
  /** 绝对容差（如利率 ±0.1 个百分点） */
  tolerance: number;
  pass: boolean;
  detail?: string;
}

/** 红线层判定结果（合规扫，机器判定） */
export interface RedlineCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

/** 工具调用证据：本次 run 真实调用过的工具名序列 */
export interface ToolTrace {
  calls: string[];
  finalContent: string;
}

/** 单个样本的运行原始结果（run-eval 阶段产出，落盘 artifacts 供人工抽检） */
export interface SampleRunResult {
  sampleId: string;
  ok: boolean;
  scene: SceneLabel;
  /** 解析出的报告快照（parseContractReport 的产物） */
  report: unknown;
  toolTrace: ToolTrace;
  fieldChecks: FieldCheck[];
  numberChecks: NumberCheck[];
  redlineChecks: RedlineCheck[];
  /** 工具链判定结果（决策 D：是否真实调用了工具 / 顺序是否合规） */
  toolChecks: FieldCheck[];
  /** 汇总：字段全 + 数值准 + 红线净 + 工具链 = 通过 */
  passed: boolean;
  costTokens?: number;
  durationMs?: number;
  error?: string;
}

/** 一轮评测的汇总 */
export interface EvalRoundResult {
  /** 评测日期 + commit hash 的目录名，如 2026-09-07_abc1234 */
  roundDir: string;
  model: string;
  runs: SampleRunResult[];
  /** 通过率 = passed 样本 / 总样本 */
  passRate: number;
  fieldPassRate: number;
  numberPassRate: number;
  redlinePassRate: number;
  totalTokens: number;
}

/** fixture manifest 文件格式 */
export interface EvalManifest {
  version: number;
  model: string;
  samples: EvalSample[];
}

/** agent systemPrompt 要求的固定免责声明（合规红线用） */
export const REDLINE_DISCLAIMER =
  '本工具基于法定标准与维权路径提供知识与建议，不代写法律文书、不出具法律意见；具体可主张金额的最终成立与金额，以裁判机关/监管部门认定或双方协商为准。';
