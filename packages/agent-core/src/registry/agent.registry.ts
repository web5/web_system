/**
 * Agent 定义注册中心。
 */
import { AgentDefinition } from '../interfaces/agent.interface';

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

  has(id: string): boolean {
    return this.agents.has(id);
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }
}
