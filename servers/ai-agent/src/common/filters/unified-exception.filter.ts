import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessException } from '../exceptions/business.exception';

/**
 * 统一异常过滤器：把所有未捕获的异常统一转成 { code, message, data }
 * HTTP 状态码固定 200，由前端根据 code 判断业务状态。
 */
@Catch()
export class UnifiedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(UnifiedExceptionFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 5000;
    let message: string | string[] = '服务器开小差了，请稍后重试';

    if (exception instanceof BusinessException) {
      status = HttpStatus.OK;
      code = exception.getCode();
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse() as { message?: string | string[] } | string;
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = res.message || message;
      }
      if (status === HttpStatus.BAD_REQUEST) code = 4000;
      else if (status === HttpStatus.UNAUTHORIZED) code = 4010;
      else if (status === HttpStatus.FORBIDDEN) code = 4030;
      else if (status === HttpStatus.NOT_FOUND) code = 4040;
      else code = 5000;
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
      message = this.isProduction ? '服务器开小差了，请稍后重试' : exception.message;
    } else {
      this.logger.error('Unknown exception', exception);
    }

    const finalMessage = Array.isArray(message) ? message.join('；') : message;

    response.status(HttpStatus.OK).json({
      code,
      message: finalMessage,
      data: null,
    });
  }
}
