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

  /**
   * 存在则更新、不存在则新增（运行时刷新定义用）。
   *
   * 纯内存操作，不依赖任何数据库/运行时。CLI 用不到也不受影响。
   * 服务层把 DB 拉取的定义转成 AgentDefinition 后调用本方法覆盖本地注册表，
   * 实现"改 prompt 运行时生效"。
   */
  upsert(agent: AgentDefinition): void {
    this.agents.set(agent.id, agent);
  }

  /**
   * 移除一个 agent（可选，用于停用/删除）。
   */
  unregister(id: string): void {
    this.agents.delete(id);
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
