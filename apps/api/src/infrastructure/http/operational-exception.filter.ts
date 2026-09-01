import { ArgumentsHost, Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { redactSensitiveText } from "../configuration/secret-boundary.js";
import {failureCategory,metrics,operationalLog,safeErrorCode} from "../observability/telemetry.js";

@Catch()
export class OperationalExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = error instanceof HttpException ? error.name : "InternalServerError";
    const safeMessage = error instanceof HttpException
      ? redactSensitiveText(error.message)
      : "Internal server error";
    const category=failureCategory(error),operation=status===401?"AUTHENTICATION":status===403?"AUTHORIZATION":"HTTP_FAILURE";
    metrics.counter("aims_domain_operations_total",{operation,outcome:"FAILURE",failure_category:category,channel:"WEB"});
    operationalLog("error","api_request_failed",{correlation_id:request.correlationId,operation,method:request.method,status_code:status,status:"FAILURE",safe_error_code:safeErrorCode(error),failure_category:category});
    response.status(status).json({ statusCode: status, code, message: safeMessage, correlationId: request.correlationId });
  }
}
