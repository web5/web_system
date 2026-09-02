import { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';

/** V3 步骤分类（步骤特性：它属于哪类平台能力，供审计/工具目录/未来换绑匹配） */
export type StepCategory =
  | 'semantic' // 发布语义（version/pointer：安全基线，不可命令覆盖）
  | 'code' // 代码获取（pull）
  | 'build' // 构建（命令驱动）
  | 'deploy' // 投递部署（upload/restart）
  | 'probe' // 探活验证（verify）
  | 'cleanup'; // 清理

/**
 * 步骤执行上下文（engine 在每次执行时为该步骤构造，是执行器与状态机之间的契约）。
 *
 * 执行器只通过 ctx 读写实例状态与进度，不感知 engine 内部实现（锁/取消集合/落库实现）。
 */
export interface StepContext {
  pipeline: DeployPipelineEntity;
  /** 投递目标（upload 步骤用，提交时快照/环境决定） */
  uploadTarget: 'local' | 'remote';
  /** 进入本步骤：写 stage/progress/带时间戳日志并落库（自动做取消校验） */
  enterStage(message: string): Promise<void>;
  /** 追加一行日志（不落库） */
  log(line: string): void;
  /** 立即落库（engine 容错实现） */
  save(): Promise<void>;
  /** 等待（verify 轮询等） */
  sleep(ms: number): Promise<void>;
  /** 取消中断点 */
  assertNotCancelled(): void;
}

/**
 * 与模块阶段命令的协作语义：
 * - `base`：先执行内置执行体，再执行该阶段配置的命令（check 的附加校验）
 * - `override`：该阶段配置了命令则覆盖执行体，未配置回退内置（pull/upload/restart/verify/cleanup）
 * - `required`：必须由命令驱动，未配置即失败（build 不做内置兜底）
 * - `none`：纯内置，不可被命令覆盖（version/pointer：发布语义真相源）
 */
export type CommandMode = 'base' | 'override' | 'required' | 'none';

/**
 * 内置步骤定义（配置化声明，取代 executeStage 的 switch 硬编码）。
 *
 * 分派规则 = 步骤特性（category / commandMode / 守卫 skip）决定的动作匹配：
 * engine 只负责「按配置查表 → 守卫跳过 → 命令覆盖优先级 → 调执行体」，
 * 不包含任何具体步骤的"怎么做"。
 */
export interface BuiltinStepDef {
  /** 步骤特性分类 */
  category: StepCategory;
  /** 与模块阶段命令的协作语义 */
  commandMode: CommandMode;
  /** 配置/实例快照守卫：true=跳过本步（复用产物 / 快线 skipVerify / 模块类型不适用） */
  skip?: (p: DeployPipelineEntity) => boolean;
  /** 执行体（commandMode 走内置路径时被调用；build/required 无内置执行体） */
  run?: (ctx: StepContext) => Promise<void>;
}
