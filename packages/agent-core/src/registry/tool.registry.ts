/**
 * 工具注册中心（全局单例）。所有 Agent 可用工具统一在此注册。
 *
 * 支持两种注册方式：
 * - register(tool)：注册一个已实例化的工具（立即可用）
 * - registerLazy(name, factory)：注册一个懒加载工厂，工具首次被 get/toSchemas 需要时才创建
 *
 * lazy 机制用于"MCP 等远程工具"，避免启动时全量拉取所有远程工具，
 * 按需拉起即可（符合 agent-core 插件化演进方向）。
 */
import { ToolDefinition, ToolSchema, ToolContext, ToolResult } from '../interfaces/tool.interface';
import { Logger } from '../lib/logger';

export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools = new Map<string, ToolDefinition>();
  /** 懒加载工具工厂：首次使用时创建并缓存 */
  private readonly lazyFactories = new Map<string, () => Promise<ToolDefinition> | ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name) || this.lazyFactories.has(tool.name)) {
      throw new Error(`工具 ${tool.name} 重复注册`);
    }
    this.tools.set(tool.name, tool);
    this.logger.debug(`已注册工具: ${tool.name}`);
  }

  /** 注册懒加载工具：工具被需要时才由 factory 创建（用于 MCP 等远程工具按需拉起） */
  registerLazy(name: string, factory: () => Promise<ToolDefinition> | ToolDefinition): void {
    if (this.tools.has(name) || this.lazyFactories.has(name)) {
      throw new Error(`工具 ${name} 重复注册`);
    }
    this.lazyFactories.set(name, factory);
    this.logger.debug(`已注册懒加载工具: ${name}`);
  }

  has(name: string): boolean {
    return this.tools.has(name) || this.lazyFactories.has(name);
  }

  /** 解析工具：先查已实例化，再按需实例化 lazy 工具（结果缓存） */
  async resolve(name: string): Promise<ToolDefinition> {
    const existing = this.tools.get(name);
    if (existing) return existing;

    const factory = this.lazyFactories.get(name);
    if (!factory) throw new Error(`工具 ${name} 未注册`);

    const tool = await factory();
    // 缓存实例，避免重复创建
    this.lazyFactories.delete(name);
    this.tools.set(name, tool);
    this.logger.debug(`懒加载工具已实例化: ${name}`);
    return tool;
  }

  async get(name: string): Promise<ToolDefinition> {
    return this.resolve(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** 列出全部工具名（含 lazy） */
  listNames(): string[] {
    return [...this.tools.keys(), ...this.lazyFactories.keys()];
  }

  async toSchemas(names: string[]): Promise<ToolSchema[]> {
    const schemas: ToolSchema[] = [];
    for (const n of names) {
      const tool = await this.resolve(n);
      schemas.push(tool.toSchema());
    }
    return schemas;
  }

  async execute(
    call: { name: string; args: Record<string, unknown>; id: string },
    ctx: ToolContext,
  ): Promise<ToolResult> {
    let tool: ToolDefinition;
    try {
      tool = await this.resolve(call.name);
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
    try {
      return await tool.execute(call.args, ctx);
    } catch (error) {
      return { success: false, content: '', error: (error as Error).message };
    }
  }
}
