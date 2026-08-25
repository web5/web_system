import { Module } from '@nestjs/common';
import { ToolRegistry } from './registry/tool.registry';
import { AgentRegistry } from './registry/agent.registry';
import { AgentEngine } from './core/agent-engine';
import { AgentRunner } from './core/agent-runner';
import { ConversationMemory } from './memory/conversation-memory';
import { ImageGenTool } from './tools/image-gen.tool';
import { CalculatorTool } from './tools/calculator.tool';

/**
 * Agent harness 统一注册入口。
 * 内置工具与 Agent 定义在此集中注册，禁止各 service 自行散落 new 工具。
 * （当前为骨架占位，实现待方案确认后填充）
 */
@Module({
  providers: [
    ToolRegistry,
    AgentRegistry,
    AgentEngine,
    AgentRunner,
    ConversationMemory,
    // 内置工具
    ImageGenTool,
    CalculatorTool,
  ],
  exports: [AgentEngine, AgentRunner, ToolRegistry, AgentRegistry, ConversationMemory],
})
export class AgentModule {}
