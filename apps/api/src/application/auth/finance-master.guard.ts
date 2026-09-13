import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

/** Gate for the Finance Master business-admin surface (User Management, and later phases). Run after AuthGuard, which populates request.principal. */
@Injectable()
export class FinanceMasterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.principal?.roles.includes("FINANCE_MASTER")) throw new ForbiddenException("Finance Master role required");
    return true;
  }
}
