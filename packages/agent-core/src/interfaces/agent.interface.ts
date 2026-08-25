/**
 * Agent 定义接口。
 */

export interface AgentMemoryConfig {
  compactionThreshold: number;
  keepRecent: number;
  enabled: boolean;
}

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  maxSteps: number;
  temperature?: number;
  memory: AgentMemoryConfig;
}
