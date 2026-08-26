import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class OperationalExceptionFilter {
  private readonly logger = new Logger("RequestFailure");

  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = error instanceof HttpException ? error.name : "InternalServerError";
    const safeMessage = error instanceof HttpException ? error.message : "Internal server error";
    this.logger.error(JSON.stringify({
      event: "request_failure",
      correlationId: request.correlationId,
      method: request.method,
      path: request.path,
      status,
      code,
    }));
    response.status(status).json({ statusCode: status, code, message: safeMessage, correlationId: request.correlationId });
  }
}
