import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { CancelApprovalDelegationDto, CreateApprovalDelegationDto, ListApprovalDelegationsDto } from "./approval-delegation.dto.js";
import { ApprovalDelegationService } from "./approval-delegation.service.js";

@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/delegation")
export class ApprovalDelegationController {
  constructor(private readonly delegations: ApprovalDelegationService) {}

  @Get()
  list(@Query() query: ListApprovalDelegationsDto) {
    return this.delegations.list(query);
  }

  @Get("history")
  history(@Query() query: ListApprovalDelegationsDto) {
    return this.delegations.history(query);
  }

  @Get(":id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.delegations.get(id);
  }

  @Post()
  create(@Body() body: CreateApprovalDelegationDto, @Req() request: Request) {
    return this.delegations.create(body, request.principal, request);
  }

  @Post(":id/cancel")
  cancel(@Param("id", ParseUUIDPipe) id: string, @Body() body: CancelApprovalDelegationDto, @Req() request: Request) {
    return this.delegations.cancel(id, body, request.principal, request);
  }
}
