import {
  Controller,
  All,
  Req,
  Res,
  Get,
  Post,
  Header,
  Logger,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ProxyService } from './proxy.service';
import { DynamicRouteService } from '../dynamic-route/dynamic-route.service';
import { IndexHtmlService } from '../deploy-version/index-html.service';
import { Public } from '../auth/public.decorator';
import * as http from 'http';
import * as url from 'url';
import { API_TIMEOUT } from '@web-system/shared';

@ApiExcludeController()
@Public() // API 路由的认证由各后端微服务自行处理，Gateway 仅做代理转发
@Controller('api')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private proxyService: ProxyService,
    private configService: ConfigService,
    // 双域重构 P2：DB 驱动路由（GATEWAY_DB_ROUTES=1 时启用；关闭时本类行为逐字节不变）
    private dynamicRouteService: DynamicRouteService,
    // 版本缓存失效（部署后由控制台调用，见 reloadRoutes）
    private indexHtmlService: IndexHtmlService,
  ) {}

  // 精确匹配 /api/auth（无尾斜杠）
  @All('auth')
  proxyAuthExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAuthProxy()(req, res);
  }

  // 通配 /api/auth/:path(*)
  @All('auth/:path(*)')
  proxyAuthWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAuthProxy()(req, res);
  }

  // 精确匹配 /api/users（无尾斜杠）
  @All('users')
  proxyUsersExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 通配 /api/users/:path(*)
  @All('users/:path(*)')
  proxyUsersWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // API Key 管理（迁至 user-service：/api/keys → user-service /keys）
  // 精确匹配 /api/keys（无尾斜杠）
  @All('keys')
  proxyKeysExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 通配 /api/keys/:path(*)
  @All('keys/:path(*)')
  proxyKeysWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 生词本 / 收藏（/api/glossary → user-service）
  // 精确匹配 /api/glossary（无尾斜杠）
  @All('glossary')
  proxyGlossaryExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 通配 /api/glossary/:path(*)
  @All('glossary/:path(*)')
  proxyGlossaryWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 用户记忆（/api/user-memory → user-service）
  // 精确匹配 /api/user-memory（无尾斜杠）
  @All('user-memory')
  proxyUserMemoryExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 通配 /api/user-memory/:path(*)
  @All('user-memory/:path(*)')
  proxyUserMemoryWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 用户口味（/api/user-taste → user-service，迁自 ai-agent）
  // 精确匹配 /api/user-taste（无尾斜杠）
  @All('user-taste')
  proxyUserTasteExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 通配 /api/user-taste/:path(*)
  @All('user-taste/:path(*)')
  proxyUserTasteWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // SSE 流式对话 — 用原生 http 转发，避免 http-proxy-middleware 缓冲问题
  @Post('ai/chat/stream')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  proxyAiChatStream(@Req() req: Request, @Res() res: Response) {
    const aiUrl = this.proxyService.getAiServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(aiUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/ai/chat/stream',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      timeout: API_TIMEOUT.GATEWAY.AI_TASK,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });

    // 客户端断开时取消上游请求
    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`SSE proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'AI service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'AI service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  // AI Agent SSE 流式（agent 编排，如合同风险识别）— 原生 http 转发
  @Post('ai-agent/agent/run')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  proxyAiAgentRun(@Req() req: Request, @Res() res: Response) {
    const agentUrl = this.proxyService.getAiAgentServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(agentUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/agent/run',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      timeout: API_TIMEOUT.GATEWAY.AI_TASK,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });

    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`AI Agent proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'AI Agent service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'AI Agent service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  // AI Agent Admin Playground SSE 流式（admin-run 端点，需 agents:debug 权限）— 原生 http 转发
  @Post('ai-agent/agent/admin-run')
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  proxyAiAgentAdminRun(@Req() req: Request, @Res() res: Response) {
    const agentUrl = this.proxyService.getAiAgentServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(agentUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/agent/admin-run',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Connection': 'keep-alive',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      timeout: API_TIMEOUT.GATEWAY.AI_TASK,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
      proxyRes.on('end', () => res.end());
    });

    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`AI Agent admin-run proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'AI Agent service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'AI Agent service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  // AI Agent 精确匹配 /api/ai-agent（无尾斜杠）
  @All('ai-agent')
  proxyAiAgentExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiAgentProxy()(req, res);
  }

  // AI Agent 通配 /api/ai-agent/:path(*)
  @All('ai-agent/:path(*)')
  proxyAiAgentWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiAgentProxy()(req, res);
  }

  // TTS 语音合成 — 用原生 http 转发，确保二进制音频流原样透传
  @Post('ai/tts/speak')
  proxyAiTtsSpeak(@Req() req: Request, @Res() res: Response) {
    const aiUrl = this.proxyService.getAiServiceUrl();
    const body = JSON.stringify(req.body);

    const parsedUrl = url.parse(aiUrl);
    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: '/ai/tts/speak',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      timeout: API_TIMEOUT.GATEWAY.TTS,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || '';

      if (contentType.startsWith('audio/')) {
        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Content-Length': proxyRes.headers['content-length'] || '',
          'Cache-Control': 'public, max-age=3600',
        });
        proxyRes.on('data', (chunk: Buffer) => res.write(chunk));
        proxyRes.on('end', () => res.end());
      } else {
        let errorBody = '';
        proxyRes.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
        proxyRes.on('end', () => {
          try {
            res.status(statusCode).json(JSON.parse(errorBody));
          } catch {
            res.status(502).json({ code: 502, message: 'TTS service error' });
          }
        });
      }
    });

    req.on('close', () => { proxyReq.destroy(); });

    proxyReq.on('error', (err) => {
      this.logger.error(`TTS proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'TTS service unavailable' });
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'TTS service timeout' });
      }
    });

    proxyReq.write(body);
    proxyReq.end();
  }

  // TTS 流式语音合成 — chunked 透传（端侧边收边播，禁止缓冲）
  @Get('ai/tts/stream')
  proxyAiTtsStream(@Req() req: Request, @Res() res: Response) {
    const aiUrl = this.proxyService.getAiServiceUrl();
    const parsedUrl = url.parse(aiUrl);
    const query = req.url.indexOf('?') >= 0 ? req.url.slice(req.url.indexOf('?') + 1) : '';

    const options: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `/ai/tts/stream${query ? `?${query}` : ''}`,
      method: 'GET',
      headers: {
        ...(req.headers.authorization ? { Authorization: req.headers.authorization as string } : {}),
      },
      // socket 空闲超时：流式持续有数据不会触发；仅兜住握手迟迟不返回的情况
      timeout: API_TIMEOUT.GATEWAY.TTS,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const statusCode = proxyRes.statusCode || 200;
      const contentType = proxyRes.headers['content-type'] || '';

      if (contentType.startsWith('audio/')) {
        res.writeHead(statusCode, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          // 禁止 nginx 缓冲：否则流式被攒成整包，边收边播失效
          'X-Accel-Buffering': 'no',
        });
        proxyRes.on('data', (chunk: Buffer) => {
          if (!res.write(chunk)) proxyRes.pause(); // 背压：消费者追上再继续
        });
        res.on('drain', () => proxyRes.resume());
        proxyRes.on('end', () => res.end());
      } else {
        let errorBody = '';
        proxyRes.on('data', (chunk: Buffer) => {
          errorBody += chunk.toString();
        });
        proxyRes.on('end', () => {
          try {
            res.status(statusCode).json(JSON.parse(errorBody));
          } catch {
            res.status(502).json({ code: 502, message: 'TTS stream service error' });
          }
        });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });

    proxyReq.on('error', (err) => {
      this.logger.error(`TTS stream proxy error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ code: 502, message: 'TTS stream service unavailable' });
      } else {
        res.end();
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ code: 504, message: 'TTS stream service timeout' });
      } else {
        res.end();
      }
    });

    proxyReq.end();
  }

  // 精确匹配 /api/ai（无尾斜杠）
  @All('ai')
  proxyAiExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiProxy()(req, res);
  }

  // 通配 /api/ai/:path(*)
  @All('ai/:path(*)')
  proxyAiWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiProxy()(req, res);
  }

  // 权限管理（/api/admin/permissions、/api/admin/roles → user-service）
  // 必须注册在 @All('admin/:path(*)')（system-service）之前，否则被通配抢走
  @All('admin/permissions')
  proxyPermsExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }
  @All('admin/permissions/:path(*)')
  proxyPermsWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }
  @All('admin/roles')
  proxyRolesExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }
  @All('admin/roles/:path(*)')
  proxyRolesWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 技能库（/api/admin/skills → ai-service）
  @All('admin/skills')
  proxySkillsExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiProxy()(req, res);
  }
  @All('admin/skills/:path(*)')
  proxySkillsWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAiProxy()(req, res);
  }

  // 当前用户权限（/api/permissions/my → user-service）
  @All('permissions/my')
  proxyMyPerms(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUserProxy()(req, res);
  }

  // 字典只读（/api/dict/:code → system-service；登录即可，供小程序/门户渲染业务枚举）
  @All('dict')
  proxyDictExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getSystemProxy()(req, res);
  }
  @All('dict/:path(*)')
  proxyDictWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getSystemProxy()(req, res);
  }

  // 精确匹配 /api/admin（无尾斜杠）
  @All('admin')
  proxySystemExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getSystemProxy()(req, res);
  }

  // 通配 /api/admin/:path(*)
  @All('admin/:path(*)')
  proxySystemWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getSystemProxy()(req, res);
  }

  // Agent 运行记录（/api/agent-runs/* → ai-service）
  @All('agent-runs')
  proxyAgentRunsExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAgentRunsProxy()(req, res);
  }
  @All('agent-runs/:path(*)')
  proxyAgentRunsWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAgentRunsProxy()(req, res);
  }

  // RAG 知识服务（/api/knowledge/* → knowledge-service）
  @All('knowledge')
  proxyKnowledgeExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getKnowledgeProxy()(req, res);
  }
  @All('knowledge/:path(*)')
  proxyKnowledgeWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getKnowledgeProxy()(req, res);
  }

  // Agent 定义管理（/api/agent-defs/* → ai-service）
  @All('agent-defs')
  proxyAgentDefsExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAgentDefsProxy()(req, res);
  }
  @All('agent-defs/:path(*)')
  proxyAgentDefsWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getAgentDefsProxy()(req, res);
  }

  // 精确匹配 /api/bianbian（无尾斜杠）
  @All('bianbian')
  proxyBianbianExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getBianbianProxy()(req, res);
  }

  // 通配 /api/bianbian/:path(*)
  @All('bianbian/:path(*)')
  proxyBianbianWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getBianbianProxy()(req, res);
  }

  // 精确匹配 /api/todos（无尾斜杠）
  @All('todos')
  proxyTodosExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getTodoProxy()(req, res);
  }

  // 通配 /api/todos/:path(*)
  @All('todos/:path(*)')
  proxyTodosWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getTodoProxy()(req, res);
  }

  // 精确匹配 /api/upload（无尾斜杠）
  @All('upload')
  proxyUploadExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadProxy()(req, res);
  }

  // 通配 /api/upload/:path(*)
  @All('upload/:path(*)')
  proxyUploadWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadProxy()(req, res);
  }

  // 精确匹配 /api/mcp（无尾斜杠）— MCP 网关管理接口
  @All('mcp')
  proxyMcpExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getMcpProxy()(req, res);
  }

  // 通配 /api/mcp/:path(*)
  @All('mcp/:path(*)')
  proxyMcpWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getMcpProxy()(req, res);
  }

  // 内容中枢通道（/api/content-hub/* → content-hub:6007）
  // 财经资讯与内容管道共用此通道（历史上另有 /api/finnews/*，已统一到本通道）
  // 服务间鉴权：验证 Authorization: Bearer $CONTENT_HUB_SERVICE_KEY（兼容旧名 FINNEWS_SERVICE_KEY）
  // 注意：必须放在 @All(':path(*)') 通配之前，否则被通配兜底 404
  @All('content-hub')
  proxyContentHubExact(@Req() req: Request, @Res() res: Response) {
    return this.checkServiceAuthAndProxy(req, res, this.proxyService.getContentProxy());
  }

  @All('content-hub/:path(*)')
  proxyContentHubWildcard(@Req() req: Request, @Res() res: Response) {
    return this.checkServiceAuthAndProxy(req, res, this.proxyService.getContentProxy());
  }

  /** 验证服务间 Bearer Token，通过后转发到指定 proxy */
  private checkServiceAuthAndProxy(req: Request, res: Response, proxy: any): Promise<void> | void {
    // 新名优先、旧名兼容：环境配置还没同步到新名时，不会静默失去鉴权
    const expected =
      this.configService.get<string>('CONTENT_HUB_SERVICE_KEY') ||
      this.configService.get<string>('FINNEWS_SERVICE_KEY');
    if (expected) {
      const auth = req.headers['authorization'];
      if (auth !== `Bearer ${expected}`) {
        this.logger.warn(`[content-hub] 鉴权失败: ${req.ip} ${req.method} ${req.path}`);
        res.status(401).json({ code: 401, message: 'Service API key required' });
        return;
      }
    }
    return proxy(req, res);
  }

  /** 变变图片静态资源（/api/uploads/bianbian/* → upload-service，404 再回落 ai-service 历史文件）
   *  必须在通用 /api/uploads/* 之前注册，否则被通用静态代理接走 */
  // 精确匹配 /api/uploads/bianbian（无尾斜杠）
  @All('uploads/bianbian')
  proxyUploadsBianbianExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.proxyBianbianStatic(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`Bianbian 图片代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  // 通配 /api/uploads/bianbian/:path(*)
  @All('uploads/bianbian/:path(*)')
  proxyUploadsBianbianWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.proxyBianbianStatic(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`Bianbian 图片代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  /** 上传文件的静态资源访问（/api/uploads/* → upload-service，A4 起） */
  // 精确匹配 /api/uploads（无尾斜杠）
  @All('uploads')
  proxyUploadStaticExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadStaticProxy()(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`静态资源代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  // 通配 /api/uploads/:path(*)
  @All('uploads/:path(*)')
  proxyUploadStaticWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getUploadStaticProxy()(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`静态资源代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  /**
   * 刷新网关缓存：DB 路由缓存（FR-10.3）+ 模块版本缓存。
   *
   * 版本缓存为什么也要在这里清：`IndexHtmlService.versionCache`（TTL 10s）决定
   * 「基座加载哪个版本目录的 `index.html`」以及非站点回落的 legacy `modules` 字段，
   * 而指针（`deploy_deployments`）是控制台「部署」/ 流水线写入的 ——
   * 不显式通知的话，部署完最多 10s 内仍加载旧版本（表现为「部署了但页面没变」）。
   *
   * 鉴权：`x-service-key` 必须匹配 GATEWAY_SERVICE_KEY / CONTENT_HUB_SERVICE_KEY
   * （旧名 FINNEWS_SERVICE_KEY 兼容读取；三者都未配置则拒绝）。
   */
  @Post('internal/gateway/reload')
  reloadRoutes(@Req() req: Request, @Res() res: Response) {
    const expected =
      this.configService.get<string>('GATEWAY_SERVICE_KEY') ||
      this.configService.get<string>('CONTENT_HUB_SERVICE_KEY') ||
      this.configService.get<string>('FINNEWS_SERVICE_KEY') ||
      '';
    if (!expected || req.headers['x-service-key'] !== expected) {
      res.status(403).json({ code: 403, message: 'service_key 校验失败（未配置或与请求头不一致）' });
      return;
    }
    this.dynamicRouteService.reload();
    const versionEntries = this.indexHtmlService.clearVersionCache();
    res.json({
      code: 0,
      message: 'DB 路由缓存 + 模块版本缓存已刷新',
      versionCacheCleared: versionEntries,
    });
  }

  /**
   * 最终兜底：硬编码路由都没匹配的 `/api/*`。
   *
   * 双域重构 P2：先尝试 DB 路由（`deploy_service_routes`）；命中则转发/拒绝，
   * **未命中保持原有 404 行为**（FR-10.2，双轨零破坏）。
   */
  @All(':path(*)')
  async proxyApi(@Req() req: Request, @Res() res: Response) {
    const handled = await this.dynamicRouteService.tryHandle(req, res);
    if (handled) return;
    res.status(404).json({ code: 404, message: `Unknown API route: ${req.method} ${req.path}` });
  }
}
