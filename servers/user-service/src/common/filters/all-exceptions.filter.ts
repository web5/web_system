import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // 兼容共享包（@web-system/shared）抛出的 HttpException 子类：
    // 若包与服务的 @nestjs/common 是不同实例，instanceof 会失败，
    // 但 getStatus 方法存在即按 HttpException 处理（避免误判 500）
    const duckHttpException =
      !!exception &&
      typeof (exception as any)?.getStatus === 'function' &&
      typeof (exception as any)?.getResponse === 'function';
    const isHttpException = exception instanceof HttpException || duckHttpException;
    const status = isHttpException
      ? (exception as HttpException).getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttpException
      ? (exception as HttpException).getResponse()
      : (exception as Error).message || 'Internal server error';

    const logMessage = {
      method: request.method,
      url: request.url,
      status,
      message: rawMessage,
      stack: exception instanceof Error ? exception.stack : undefined,
    };
    this.logger.error(JSON.stringify(logMessage));

    // 生产环境对非 HttpException 返回通用错误，不泄露内部信息
    const clientMessage = isHttpException
      ? rawMessage
      : this.isProduction
        ? '服务器内部错误'
        : (exception as Error).message || 'Internal server error';

    const responseMessage =
      typeof clientMessage === 'string'
        ? clientMessage
        : (clientMessage as any).message || clientMessage;

    response.status(status).json({
      statusCode: status,
      message: responseMessage,
      error: HttpStatus[status] || 'Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
