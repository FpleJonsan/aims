import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { RolePermissionService } from "../role-permission/role-permission.service.js";
import { PERMISSION_METADATA_KEY } from "./require-permission.decorator.js";

/**
 * Fine-grained authorization gate introduced by P21. Run after AuthGuard,
 * which populates request.principal. Not yet applied to any existing route —
 * it exists here, alongside @RequirePermission, for future phases to adopt
 * without duplicating the union-of-roles computation.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rolePermissions: RolePermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_METADATA_KEY, [context.getHandler(), context.getClass()]);
    if (!required) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const granted = await this.rolePermissions.getEffectivePermissionCodes(request.principal);
    if (!granted.has(required)) throw new ForbiddenException(`Missing permission: ${required}`);
    return true;
  }
}
