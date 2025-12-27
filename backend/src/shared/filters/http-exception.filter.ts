import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger
} from '@nestjs/common';
import { Request } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';

    const message =
      typeof errorResponse === 'string'
        ? errorResponse
        : (errorResponse as any)?.message || 'Unexpected error';

    const details = typeof errorResponse === 'object' ? (errorResponse as any)?.message : undefined;
    const code =
      typeof errorResponse === 'object' && (errorResponse as any)?.error
        ? (errorResponse as any).error
        : HttpStatus[status] || 'ERROR';

    this.logger.error(
      `Request failed: ${request?.['method']} ${request?.['url']} -> ${status} ${message}`,
      (exception as any)?.stack
    );

    response.status(status).json({
      error: {
        code,
        message,
        ...(details && Array.isArray(details) ? { details } : details ? { details } : {})
      }
    });
  }
}
