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

    this.logger.error(
      `${request.method} ${request.url} → ${status}: ${JSON.stringify(rawMessage)}`,
      exception instanceof Error ? exception.stack : undefined,
    );

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
