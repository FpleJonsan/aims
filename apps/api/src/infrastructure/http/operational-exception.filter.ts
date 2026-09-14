import { ArgumentsHost, Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { redactSensitiveData } from "../configuration/secret-boundary.js";
import {failureCategory,metrics,operationalLog,safeErrorCode} from "../observability/telemetry.js";

/**
 * HttpException.message degrades to the generic "Bad Request Exception" whenever
 * the exception body is an array or object without its own .message string — which
 * is exactly what Nest's ValidationPipe throws (an array of per-field messages).
 * The real detail lives in getResponse().message, so read from there instead.
 */
function exceptionMessage(error: HttpException): unknown {
  const body = error.getResponse();
  if (typeof body === "string") return body;
  if (body && typeof body === "object" && "message" in body) {
    return (body as { message?: unknown }).message ?? error.message;
  }
  return error.message;
}

@Catch()
export class OperationalExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = error instanceof HttpException ? error.name : "InternalServerError";
    const safeMessage = error instanceof HttpException
      ? redactSensitiveData(exceptionMessage(error))
      : "Internal server error";
    const category=failureCategory(error),operation=status===401?"AUTHENTICATION":status===403?"AUTHORIZATION":"HTTP_FAILURE";
    metrics.counter("aims_domain_operations_total",{operation,outcome:"FAILURE",failure_category:category,channel:"WEB"});
    operationalLog("error","api_request_failed",{correlation_id:request.correlationId,operation,method:request.method,status_code:status,status:"FAILURE",safe_error_code:safeErrorCode(error),failure_category:category});
    response.status(status).json({ statusCode: status, code, message: safeMessage, correlationId: request.correlationId });
  }
}
