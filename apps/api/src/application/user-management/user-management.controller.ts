import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { ApprovalAuthorityDto, AssignRolesDto, CreateUserDto, ListUsersDto } from "./user-management.dto.js";
import { UserManagementService } from "./user-management.service.js";

@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/users")
export class UserManagementController {
  constructor(private readonly users: UserManagementService) {}

  @Get()
  list(@Query() query: ListUsersDto) {
    return this.users.list(query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post()
  create(@Body() body: CreateUserDto, @Req() request: Request) {
    return this.users.create(body, request.principal, request);
  }

  @Post(":id/disable")
  disable(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.setActive(id, false, request.principal, request);
  }

  @Post(":id/enable")
  enable(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.setActive(id, true, request.principal, request);
  }

  @Post(":id/lock")
  lock(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.lock(id, request.principal, request);
  }

  @Post(":id/unlock")
  unlock(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.unlock(id, request.principal, request);
  }

  @Post(":id/reset-password")
  resetPassword(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.resetPassword(id, request.principal, request);
  }

  @Post(":id/force-password-reset")
  forcePasswordReset(@Param("id", ParseUUIDPipe) id: string, @Req() request: Request) {
    return this.users.forcePasswordReset(id, request.principal, request);
  }

  @Patch(":id/roles")
  assignRoles(@Param("id", ParseUUIDPipe) id: string, @Body() body: AssignRolesDto, @Req() request: Request) {
    return this.users.assignRoles(id, body.roles, request.principal, request);
  }

  @Put(":id/approval-authority")
  upsertApprovalAuthority(@Param("id", ParseUUIDPipe) id: string, @Body() body: ApprovalAuthorityDto, @Req() request: Request) {
    return this.users.upsertApprovalAuthority(id, body, request.principal, request);
  }
}
