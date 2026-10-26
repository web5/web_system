/**
 * Agent 运行封装：生成 runId，委托引擎执行流式运行。
 */
import { randomUUID } from 'crypto';
import { AgentEngine } from './agent-engine';
import { type StreamEvent, type RunInput } from '../interfaces/runtime.interface';

export class AgentRunner {
  constructor(private readonly engine: AgentEngine) {}

  /**
   * @param runId 可选：由编排层（controller）预先生成并透传，使 SSE 事件里的 runId
   *              与引擎侧 ToolContext/遥测/落库同值（N5，2026-10-26）。
   *              不传则在此生成（向后兼容）。
   */
  stream(
    input: RunInput,
    userId: string,
    confirmHandler?: (message: string) => Promise<boolean>,
    runId?: string,
  ): AsyncGenerator<StreamEvent> {
    const id = runId ?? randomUUID();
    return this.engine.run(input, userId, id, confirmHandler);
  }
}
