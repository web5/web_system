import { Injectable } from '@nestjs/common';
import { AgentDefinition } from '../interfaces/agent.interface';

/**
 * Agent 定义注册中心。
 * 骨架占位：实现待方案确认后填充
 */
@Injectable()
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} 重复注册`);
    }
    this.agents.set(agent.id, agent);
  }

  get(id: string): AgentDefinition {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Agent ${id} 未注册`);
    return agent;
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
