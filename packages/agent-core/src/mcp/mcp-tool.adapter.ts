/**
 * MCP 工具适配器：把 MCP 工具元数据包装成 agent-core 的 ToolDefinition，
 * 使 Agent 引擎可以像调用本地工具一样调用 MCP 暴露的远程工具。
 *
 * 这是"一切皆插件"的一部分：MCP 工具作为"远程 Provider"接入统一 Tool 契约。
 *
 * 注意：agent-core 保持零依赖，不直接依赖 @modelcontextprotocol/sdk。
 * 实际的 MCP 调用由注入的 executor 回调完成（由 ai-agent 等服务层实现 HTTP/MCP 通信）。
 */
import {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolSchema,
  ToolParameter,
  ToolParamType,
} from '../interfaces/tool.interface';

/** MCP 工具参数的字段定义（与 MCP inputSchema JSON-Schema 对齐） */
export interface McpToolParameter {
  type: string;
  description?: string;
  required?: boolean;
}

/** MCP 工具元数据（来自 MCP server tools/list 或网关工具声明） */
export interface McpToolMeta {
  /** MCP 工具名 */
  name: string;
  description?: string;
  /** JSON-Schema 风格的参数定义 */
  inputSchema?: {
    type?: string;
    properties?: Record<string, McpToolParameter>;
    required?: string[];
  };
  /** 所属 MCP 模块/服务 */
  module?: string;
  /**
   * 是否写操作（发布/回滚/删除等）——执行前需权限确认。
   * 为 true 时执行前调用 ctx.confirm，无确认器默认拒绝。
   */
  requiresConfirm?: boolean;
}

/** MCP 工具执行器：由服务层注入，负责实际调用远程 MCP 能力 */
export interface McpToolExecutor {
  execute(meta: McpToolMeta, args: Record<string, unknown>): Promise<{ content: string }>;
}

/** 把 JSON-Schema type 归一化为 ToolParamType */
function normalizeType(type?: string): ToolParamType {
  switch ((type || 'string').toLowerCase()) {
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
}

/**
 * 把 MCP 工具元数据包装成 ToolDefinition。
 * 用法：const tool = new McpToolAdapter(meta, executor)
 */
export class McpToolAdapter implements ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, ToolParameter>;

  constructor(
    private readonly meta: McpToolMeta,
    private readonly executor: McpToolExecutor,
  ) {
    this.name = meta.name;
    this.description = meta.description || `MCP 工具 ${meta.name}`;
    const properties = meta.inputSchema?.properties || {};
    const requiredArr = meta.inputSchema?.required || [];
    const params: Record<string, ToolParameter> = {};
    for (const [key, param] of Object.entries(properties)) {
      params[key] = {
        type: normalizeType(param.type),
        description: param.description || '',
        required: param.required ?? requiredArr.includes(key),
      };
    }
    this.parameters = params;
  }

  toSchema(): ToolSchema {
    const properties: Record<string, { type: string; description: string }> = {};
    const required: string[] = [];

    for (const [key, param] of Object.entries(this.parameters)) {
      properties[key] = {
        type: param.type || 'string',
        description: param.description || '',
      };
      if (param.required) required.push(key);
    }
    const requiredArr = this.meta.inputSchema?.required;
    if (Array.isArray(requiredArr)) {
      for (const r of requiredArr) {
        if (!required.includes(r)) required.push(r);
      }
    }

    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties,
          required,
        },
      },
    };
  }

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    try {
      // 写操作（requiresConfirm）执行前权限确认：无确认器默认拒绝，与本地工具行为一致
      if (this.meta.requiresConfirm) {
        if (!ctx.confirm) {
          return {
            success: false,
            content: '',
            error: `MCP 写操作 ${this.name} 需权限确认，但当前环境无确认器（默认拒绝）`,
          };
        }
        const ok = await ctx.confirm(
          `⚠️ 即将执行 MCP 写操作：${this.name}\n参数：${JSON.stringify(args)}\n确认继续? [y/N] `,
        );
        if (ok !== true) {
          return { success: false, content: '', error: `MCP 写操作 ${this.name} 已被用户拒绝。` };
        }
      }
      const result = await this.executor.execute(this.meta, args);
      return { success: true, content: result.content };
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
