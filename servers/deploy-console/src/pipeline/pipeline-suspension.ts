/**
 * 流水线「挂起」信号（P0：approval 节点执行到即暂停等待人工决议）。
 *
 * 为什么用异常而不是返回值：审批节点可能嵌在任意深度的调用里
 * （`run` → `executeStage` → `executeV5Node` → approval 分支），
 * 返回值要一路透传、非常容易在中途被吞掉（改成 failed）。异常能直接从
 * 最深处的节点跳出到 `run` 的主 catch，由那里统一落「挂起态」。
 *
 * 与普通失败的区别：挂起**不是失败** —— 不写 error、不触发回滚、不算终态。
 */
export class PipelineSuspended extends Error {
  constructor(
    /** 挂起所在的节点 key（恢复锚点：从它**之后**继续） */
    readonly nodeKey: string,
    /** 关联的审批单 ID */
    readonly approvalId: string,
    /** 节点展示名（日志/通知用） */
    readonly nodeLabel?: string,
  ) {
    super(`流水线已在节点「${nodeLabel ?? nodeKey}」挂起，等待审批（${approvalId}）`);
    this.name = 'PipelineSuspended';
  }
}

/** 类型守卫：避免 `instanceof` 在多包/多实例下失效（ts-jest / 多副本加载） */
export function isPipelineSuspended(e: unknown): e is PipelineSuspended {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: string }).name === 'PipelineSuspended' &&
    typeof (e as PipelineSuspended).nodeKey === 'string'
  );
}

/**
 * 恢复起点（纯函数）：从 `resumeAfter` 的**下一个**节点开始。
 *
 * `resumeAfter` 缺失或不在执行计划里（模板被改过 / 老实例）→ 从头执行：
 * 宁可重跑已完成的节点，也不静默跳过（跳过的代价是"没发布却显示成功"）。
 */
export function resolveStartIndex(keys: string[], resumeAfter?: string | null): number {
  if (!resumeAfter) return 0;
  const i = keys.indexOf(resumeAfter);
  return i < 0 ? 0 : i + 1;
}
