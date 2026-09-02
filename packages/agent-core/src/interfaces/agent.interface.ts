/**
 * Agent 定义接口。
 */

export interface AgentMemoryConfig {
  compactionThreshold: number;
  keepRecent: number;
  enabled: boolean;
}

/** 能力统一引用：本地工具 / MCP 远程工具 / Skill（方案 C 的 Capability 抽象） */
export interface CapabilityRef {
  type: 'tool' | 'mcp' | 'skill';
  /** tool: 'contract-irr'；mcp: 'finnews/get_market_pulse'；skill: 'web-system-finnews' */
  ref: string;
  enabled: boolean;
  /** 能力级配置（mcp 可覆盖 timeout；skill 预留挂载模式等） */
  config?: Record<string, unknown>;
}

/** 可挂载技能的摘要引用（on-demand 注入 system 用） */
export interface SkillRef {
  /** 技能 code，如 web-system-finnews */
  code: string;
  name: string;
  /** 摘要（50~100 字），模型判断是否需要加载全文 */
  description: string;
  /** 依赖工具：本地工具名 或 mcp:module/tool */
  requiredTools?: string[];
  enabled?: boolean;
}

/** 技能完整定义（load_skill 返回的全文） */
export interface Skill extends SkillRef {
  version: string;
  /** SKILL.md 全文（Markdown 行为守则） */
  content: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  /** 本地工具名数组（向后兼容；新配置统一走 capabilities） */
  tools: string[];
  maxSteps: number;
  temperature?: number;
  memory: AgentMemoryConfig;
  /** 三类能力统一引用（tool / mcp / skill） */
  capabilities?: CapabilityRef[];
  /** 冗余：可挂载的 skill 摘要目录（与 capabilities 中 type='skill' 对应） */
  skills?: SkillRef[];
  /**
   * 是否流式输出（默认 true）。
   * true=content_delta 逐字推送；false=最终回答一次性输出。
   */
  streaming?: boolean;
}
