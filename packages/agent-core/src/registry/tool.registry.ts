/**
 * 工具注册中心（全局单例）。所有 Agent 可用工具统一在此注册。
 */
import { ToolDefinition, ToolSchema, ToolContext, ToolResult } from '../interfaces/tool.interface';
import { Logger } from '../lib/logger';

export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 ${tool.name} 重复注册`);
    }
    this.tools.set(tool.name, tool);
    this.logger.debug(`已注册工具: ${tool.name}`);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`工具 ${name} 未注册`);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toSchemas(names: string[]): ToolSchema[] {
    return names.map((n) => this.get(n).toSchema());
  }

  async execute(
    call: { name: string; args: Record<string, unknown>; id: string },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.get(call.name);
    try {
      return await tool.execute(call.args, ctx);
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
