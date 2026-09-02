import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

/**
 * 全局异常过滤器
 * - HttpException：返回其状态码与结构化 message
 * - 非 HttpException：生产环境统一返回「服务器内部错误」，避免泄漏内部细节；开发环境返回真实 message 便于排障
 * - 所有未捕获异常均记录错误日志（含堆栈），但响应中不包含堆栈
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status: number = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string;
    if (isHttp) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object' && 'message' in res) {
        const m = (res as Record<string, unknown>).message;
        message = typeof m === 'string' ? m : exception.message;
      } else {
        message = exception.message;
      }
    } else {
      const isProduction = process.env.NODE_ENV === 'production';
      message = isProduction
        ? '服务器内部错误'
        : exception instanceof Error
          ? exception.message
          : '服务器内部错误';
      this.logger.error(
        `未捕获异常: ${exception instanceof Error ? exception.stack : JSON.stringify(exception)}`,
      );
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
