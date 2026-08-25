import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentEngine } from './agent-engine';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';

/**
 * Agent 运行封装：生成 runId，委托引擎执行流式运行。
 */
@Injectable()
export class AgentRunner {
  constructor(private readonly engine: AgentEngine) {}

  stream(input: RunInput, userId: string): AsyncGenerator<StreamEvent> {
    const runId = randomUUID();
    return this.engine.run(input, userId, runId);
  }
}
