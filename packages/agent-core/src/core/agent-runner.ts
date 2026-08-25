/**
 * Agent 运行封装：生成 runId，委托引擎执行流式运行。
 */
import { randomUUID } from 'crypto';
import { AgentEngine } from './agent-engine';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';

export class AgentRunner {
  constructor(private readonly engine: AgentEngine) {}

  stream(input: RunInput, userId: string, confirmHandler?: (message: string) => Promise<boolean>): AsyncGenerator<StreamEvent> {
    const runId = randomUUID();
    return this.engine.run(input, userId, runId, confirmHandler);
  }
}
