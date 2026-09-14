import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { CloneRoleDto, CreateRoleDto, ListRolesDto, SetRolePermissionsDto, UpdateRoleDto } from "./role-permission.dto.js";
import { RolePermissionService } from "./role-permission.service.js";

@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/roles")
export class RoleController {
  constructor(private readonly rolePermissions: RolePermissionService) {}

  @Get()
  list(@Query() query: ListRolesDto) {
    return this.rolePermissions.list(query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.rolePermissions.get(id);
  }

  @Post()
  create(@Body() body: CreateRoleDto, @Req() request: Request) {
    return this.rolePermissions.create(body, request.principal, request);
  }

  @Patch(":id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateRoleDto, @Req() request: Request) {
    return this.rolePermissions.update(id, body, request.principal, request);
  }

  @Post(":id/clone")
  clone(@Param("id", ParseUUIDPipe) id: string, @Body() body: CloneRoleDto, @Req() request: Request) {
    return this.rolePermissions.clone(id, body, request.principal, request);
  }

  @Patch(":id/permissions")
  setPermissions(@Param("id", ParseUUIDPipe) id: string, @Body() body: SetRolePermissionsDto, @Req() request: Request) {
    return this.rolePermissions.setPermissions(id, body, request.principal, request);
  }
}

@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/permissions")
export class PermissionCatalogController {
  constructor(private readonly rolePermissions: RolePermissionService) {}

  @Get()
  list() {
    return this.rolePermissions.listPermissions();
  }
}
