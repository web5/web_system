// 工具调用接口定义（OpenAI 标准 tools / tool_calls 协议）
// 骨架占位：实现待方案确认后填充

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
