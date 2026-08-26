import {
  Controller,
  All,
  Req,
  Res,
  Post,
  Header,
  Logger,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { ProxyService } from './proxy.service';
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

  // 财经通道（/api/finnews/* → content-hub:6007）
  // 服务间鉴权：验证 Authorization: Bearer $FINNEWS_SERVICE_KEY
  // 注意：必须放在 @All(':path(*)') 通配之前，否则被通配兜底 404
  @All('finnews')
  proxyFinnewsExact(@Req() req: Request, @Res() res: Response) {
    return this.checkServiceAuthAndProxy(req, res, this.proxyService.getFinnewsProxy());
  }

  @All('finnews/:path(*)')
  proxyFinnewsWildcard(@Req() req: Request, @Res() res: Response) {
    return this.checkServiceAuthAndProxy(req, res, this.proxyService.getFinnewsProxy());
  }

  // 内容管道通道（/api/content-hub/* → content-hub:6007）
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
    const expected = this.configService.get<string>('FINNEWS_SERVICE_KEY');
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

  /** AI 生成的变变图片静态资源（/api/uploads/bianbian/* → ai-service）
   *  必须在通用 /api/uploads/* 之前注册，确保优先级高于 user-service 代理 */
  // 精确匹配 /api/uploads/bianbian（无尾斜杠）
  @All('uploads/bianbian')
  proxyUploadsBianbianExact(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getBianbianStaticProxy()(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`Bianbian 图片代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  // 通配 /api/uploads/bianbian/:path(*)
  @All('uploads/bianbian/:path(*)')
  proxyUploadsBianbianWildcard(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.getBianbianStaticProxy()(req, res, (e?: Error) => {
      if (e) {
        this.logger.error(`Bianbian 图片代理错误: ${e.message}`);
      }
      res.status(404).json({ code: 404, message: 'File not found' });
    });
  }

  /** 上传文件的静态资源访问（/api/uploads/* → user-service） */
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

  @All(':path(*)')
  proxyApi(@Req() req: Request, @Res() res: Response) {
    res.status(404).json({ code: 404, message: `Unknown API route: ${req.method} ${req.path}` });
  }
}
