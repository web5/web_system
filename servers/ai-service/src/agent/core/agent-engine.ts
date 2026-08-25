import { Injectable } from '@nestjs/common';
import { AgentDefinition } from '../interfaces/agent.interface';
import { StreamEvent, RunInput } from '../interfaces/runtime.interface';
import { ToolRegistry } from '../registry/tool.registry';
import { AgentRegistry } from '../registry/agent.registry';

/**
 * Agent 运行引擎（ReAct 循环）。
 * 骨架占位：实现待方案确认后填充。
 *
 * 核心流程：
 *   for step in 0..maxSteps:
 *     resp = client.chatWithTools(messages, toolSchemas, agent)
 *     if 无 toolCalls: yield final; return
 *     逐个执行工具 → 回写 tool 消息 → yield tool_call/tool_result
 */
@Injectable()
export class AgentEngine {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly agentRegistry: AgentRegistry,
  ) {}

  async *run(input: RunInput): AsyncGenerator<StreamEvent> {
    // TODO: 实现 ReAct 循环（见 design doc 第 3 节）
    const agent = this.agentRegistry.get(input.agentId);
    void agent;
    yield { type: 'error', content: 'AgentEngine 未实现' };
  }
}
