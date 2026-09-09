/**
 * 工具接口定义（OpenAI 标准 tools / tool_calls 协议）。
 * agent-core 内为纯 TS，无 Nest 依赖。
 */

export type ToolParamType = 'string' | 'number' | 'boolean' | 'object' | 'array';

/** 输出到模型 tools payload 的 JSON-Schema 属性（OpenAI 协议子集；由 ToolParameter 递归生成） */
export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
}

export interface ToolParameter {
  type: ToolParamType;
  description: string;
  required?: boolean;
  /** type=string|number 时限定取值（模型据此约束输出，避免自由发挥） */
  enum?: (string | number | boolean)[];
  /** type=array 时元素规格（可继续嵌套 enum/object/array） */
  items?: ToolParameter;
  /** type=object 时子属性规格 */
  properties?: Record<string, ToolParameter>;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, JsonSchemaProperty>;
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
