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

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttpException
      ? exception.getResponse()
      : (exception as Error).message || 'Internal server error';

    // 始终在服务端记录完整错误信息
    const logMessage = {
      method: request.method,
      url: request.url,
      status,
      message: rawMessage,
      stack: exception instanceof Error ? exception.stack : undefined,
    };
    this.logger.error(JSON.stringify(logMessage, null, 2));

    // 生产环境对非 HttpException 返回通用错误，不泄露内部信息
    const clientMessage = isHttpException
      ? rawMessage
      : this.isProduction
        ? '服务器内部错误'
        : (exception as Error).message || 'Internal server error';

    response.status(status).json({
      statusCode: status,
      message: typeof clientMessage === 'string' ? clientMessage : (clientMessage as any).message || clientMessage,
      error: HttpStatus[status] || 'Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
