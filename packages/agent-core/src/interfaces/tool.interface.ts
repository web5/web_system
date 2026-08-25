/**
 * 工具接口定义（OpenAI 标准 tools / tool_calls 协议）。
 * agent-core 内为纯 TS，无 Nest 依赖。
 */

export type ToolParamType = 'string' | 'number' | 'boolean' | 'object';

export interface ToolParameter {
  type: ToolParamType;
  description: string;
  required?: boolean;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

export interface ToolContext {
  userId: string;
  runId: string;
  deps: Record<string, unknown>;
  /**
   * 权限确认器：危险操作（删除/覆盖写等）前调用。
   * 交互式 CLI 注入弹确认框；未注入（非交互）时视为拒绝。
   */
  confirm?(message: string): Promise<boolean>;
}

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  toSchema(): ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
