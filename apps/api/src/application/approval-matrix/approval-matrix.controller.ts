import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import {
  ListApprovalMatrixVersionsDto,
  PublishApprovalMatrixDto,
  RollbackApprovalMatrixDto,
  SaveApprovalMatrixDraftDto,
} from "./approval-matrix.dto.js";
import { ApprovalMatrixService } from "./approval-matrix.service.js";

@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/approval-matrix")
export class ApprovalMatrixController {
  constructor(private readonly matrix: ApprovalMatrixService) {}

  @Get("active")
  getActive() {
    return this.matrix.getActive();
  }

  @Get("draft")
  async getDraft() {
    return (await this.matrix.getDraft()) ?? { id: null };
  }

  @Post("draft")
  saveDraft(@Body() body: SaveApprovalMatrixDraftDto, @Req() request: Request) {
    return this.matrix.saveDraft(body.payload, request.principal, request);
  }

  @Delete("draft")
  discardDraft(@Req() request: Request) {
    return this.matrix.discardDraft(request.principal, request);
  }

  @Get("preview")
  preview() {
    return this.matrix.preview();
  }

  @Post("publish")
  publish(@Body() body: PublishApprovalMatrixDto, @Req() request: Request) {
    return this.matrix.publish(body.reason, request.principal, request);
  }

  @Post("rollback")
  rollback(@Body() body: RollbackApprovalMatrixDto, @Req() request: Request) {
    return this.matrix.rollback(body.targetVersion, body.reason, request.principal, request);
  }

  @Get("versions")
  listVersions(@Query() query: ListApprovalMatrixVersionsDto) {
    return this.matrix.listVersions(Number(query.page ?? 1), Number(query.pageSize ?? 25));
  }

  @Get("versions/:version")
  getVersion(@Param("version", ParseIntPipe) version: number) {
    return this.matrix.getVersion(version);
  }
}
