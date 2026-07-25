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

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : (exception as Error).message || 'Internal server error';

    const logMessage = {
      method: request.method,
      url: request.url,
      status,
      message,
      stack: exception instanceof Error ? exception.stack : undefined,
    };
    this.logger.error(JSON.stringify(logMessage));

    const responseMessage =
      typeof message === 'string'
        ? message
        : (message as any).message || message;

    // Multer 文件太大错误特殊处理
    if (
      exception instanceof Error &&
      exception.message.includes('File too large')
    ) {
      response.status(413).json({
        statusCode: 413,
        message: '文件大小超过限制',
        error: 'Payload Too Large',
        path: request.url,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    response.status(status).json({
      statusCode: status,
      message: responseMessage,
      error: HttpStatus[status] || 'Error',
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
