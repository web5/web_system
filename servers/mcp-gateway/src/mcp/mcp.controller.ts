import { Controller, Post, Get, Delete, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpService } from './mcp.service';

/**
 * MCP streamable-http 端点
 *   POST/GET/DELETE /mcp           → 聚合所有启用模块的工具
 *   POST/GET/DELETE /mcp/:module   → 只暴露指定模块（按 code_key）的工具
 *
 * 鉴权：每个请求验证 Authorization: Bearer <MCP_CLIENT_KEY>
 *   （stateless，无登录态；MCP_CLIENT_KEY 未配置时跳过，方便本地开发）
 */
@Controller()
export class McpController {
  constructor(
    private readonly mcpService: McpService,
    private readonly configService: ConfigService,
  ) {}

  // ── /mcp 聚合入口 ──

  @Post('mcp')
  post(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handlePost(req, res, undefined);
  }

  @Get('mcp')
  get(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handleGet(req, res, undefined);
  }

  @Delete('mcp')
  delete(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.handleDelete(req, res, undefined);
  }

  // ── /mcp/:module 单模块入口 ──

  @Post('mcp/:module')
  postModule(
    @Req() req: Request,
    @Res() res: Response,
    @Param('module') module: string,
  ): Promise<void> {
    return this.handlePost(req, res, module);
  }

  @Get('mcp/:module')
  getModule(
    @Req() req: Request,
    @Res() res: Response,
    @Param('module') module: string,
  ): Promise<void> {
    return this.handleGet(req, res, module);
  }

  @Delete('mcp/:module')
  deleteModule(
    @Req() req: Request,
    @Res() res: Response,
    @Param('module') module: string,
  ): Promise<void> {
    return this.handleDelete(req, res, module);
  }

  // ── 共享实现 ──

  /**
   * 验证客户端 Bearer token：
   *   1) 兼容遗留共享密钥 MCP_CLIENT_KEY（内部/WorkBuddy 集成）
   *   2) 每用户 API Key（调 user-service 内部 /internal/keys/verify，支持吊销/过期）
   */
  private async checkAuth(req: Request, res: Response): Promise<boolean> {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized: missing Bearer token' },
        id: null,
      });
      return false;
    }
    const token = auth.slice(7).trim();
    const legacy = this.configService.get<string>('MCP_CLIENT_KEY');
    if (legacy && token === legacy) return true;
    const valid = await this.verifyViaUserService(token);
    if (valid) return true;
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Unauthorized: invalid or revoked API key' },
      id: null,
    });
    return false;
  }

  /** 调 user-service 内部接口校验 key（同机 127.0.0.1:6002，受 INTERNAL_API_KEY 保护） */
  private async verifyViaUserService(token: string): Promise<boolean> {
    const base = this.configService.get<string>('USER_SERVICE_URL', 'http://127.0.0.1:6002');
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    try {
      const r = await fetch(`${base}/internal/keys/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': internalKey || '',
        },
        body: JSON.stringify({ key: token }),
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) return false;
      const data = (await r.json()) as { valid?: boolean };
      return !!data.valid;
    } catch (e) {
      console.error('[mcp] verify via user-service failed:', e);
      return false;
    }
  }

  private async handlePost(req: Request, res: Response, moduleCode?: string): Promise<void> {
    if (!(await this.checkAuth(req, res))) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    try {
      const existing = sessionId ? this.mcpService.getTransport(sessionId) : undefined;
      if (existing) {
        await existing.handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = moduleCode
          ? await this.mcpService.createModuleTransport(moduleCode)
          : await this.mcpService.createTransport();
        await transport.handleRequest(req, res, req.body);
        return;
      }
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID' },
        id: null,
      });
    } catch (e: any) {
      console.error(`[mcp${moduleCode ? '/' + moduleCode : ''}] POST 处理失败:`, e);
      if (!res.headersSent) {
        if (e.status === 404) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: e.message },
            id: null,
          });
          return;
        }
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  private async handleGet(req: Request, res: Response, _moduleCode?: string): Promise<void> {
    if (!(await this.checkAuth(req, res))) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? this.mcpService.getTransport(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
  }

  private async handleDelete(req: Request, res: Response, _moduleCode?: string): Promise<void> {
    if (!(await this.checkAuth(req, res))) return;
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? this.mcpService.getTransport(sessionId) : undefined;
    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transport.handleRequest(req, res);
    if (sessionId) this.mcpService.removeTransport(sessionId);
  }
}