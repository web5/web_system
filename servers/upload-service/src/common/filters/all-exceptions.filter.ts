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

    // Multer 文件太大错误特殊处理（最高优先级）
    if (
      exception instanceof Error &&
      exception.message.includes('File too large')
    ) {
      this.logger.error(`File too large: ${request.url}`);
      response.status(413).json({
        statusCode: 413,
        message: '文件大小超过限制',
        error: 'Payload Too Large',
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const rawMessage = isHttpException
      ? exception.getResponse()
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
