import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    // 🔴 Sólo se rellenan cuando la excepción trae código estable (`CodedException`).
    //   Para el resto de módulos se quedan en `undefined` y la clave NO aparece en
    //   el JSON ⇒ el cuerpo de los demás endpoints es byte a byte el de antes.
    let code: string | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.message;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, any>;
        message = res.message ?? exception.message;
        error = res.error ?? exception.message;
        if (typeof res.code === 'string') {
          code = res.code;
        }
        if (res.details !== undefined) {
          details = res.details;
        }
      }
    }

    response.status(status).json({
      statusCode: status,
      // `code` y `details` van DESPUÉS de los campos de siempre para que un
      // lector diferencial no note el cambio en los endpoints sin código.
      ...(code === undefined ? {} : { code }),
      message,
      error,
      ...(details === undefined ? {} : { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
