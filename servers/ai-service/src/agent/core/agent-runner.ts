import { Injectable } from '@nestjs/common';
import { AgentEngine } from './agent-engine';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';

/**
 * Agent 运行封装：对接 SSE 输出、会话状态管理。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class AgentRunner {
  constructor(private readonly engine: AgentEngine) {}

  async *stream(input: RunInput): AsyncGenerator<StreamEvent> {
    yield* this.engine.run(input);
  }
}
