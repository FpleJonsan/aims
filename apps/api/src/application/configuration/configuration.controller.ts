import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { ConfigurationService } from "./configuration.service.js";
import { ListConfigurationVersionsDto, PublishConfigurationDto, RollbackConfigurationDto, SaveDraftDto } from "./configuration.dto.js";

/**
 * P20.5D Business Configuration Platform. Six settings categories (Company,
 * Finance, Business Numbering, AI, Notifications, System Parameters) share
 * this one route surface, gated the same way as Master Data and Roles
 * (Finance Master only) — see the architecture note in configuration.service.ts.
 */
@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/configuration")
export class ConfigurationController {
  constructor(private readonly configuration: ConfigurationService) {}

  @Get("versions")
  listAllVersions(@Query() query: ListConfigurationVersionsDto & { page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    return this.configuration.listVersions(query.category, page, pageSize);
  }

  @Get(":category")
  getActive(@Param("category") category: string) {
    return this.configuration.getActive(category);
  }

  @Get(":category/draft")
  async getDraft(@Param("category") category: string) {
    return { draft: await this.configuration.getDraft(category) };
  }

  @Put(":category/draft")
  saveDraft(@Param("category") category: string, @Body() body: SaveDraftDto, @Req() request: Request) {
    return this.configuration.saveDraft(category, body.payload, request.principal, request);
  }

  @Post(":category/draft/discard")
  discardDraft(@Param("category") category: string, @Req() request: Request) {
    return this.configuration.discardDraft(category, request.principal, request);
  }

  @Get(":category/preview")
  preview(@Param("category") category: string) {
    return this.configuration.preview(category);
  }

  @Post(":category/publish")
  publish(@Param("category") category: string, @Body() body: PublishConfigurationDto, @Req() request: Request) {
    return this.configuration.publish(category, body.reason, request.principal, request);
  }

  @Get(":category/versions")
  listVersions(@Param("category") category: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.configuration.listVersions(category, Math.max(1, Number(page ?? 1)), Math.min(100, Math.max(1, Number(pageSize ?? 20))));
  }

  @Get(":category/versions/:version")
  getVersion(@Param("category") category: string, @Param("version", ParseIntPipe) version: number) {
    return this.configuration.getVersion(category, version);
  }

  @Post(":category/versions/:version/rollback")
  rollback(@Param("category") category: string, @Param("version", ParseIntPipe) version: number, @Body() body: RollbackConfigurationDto, @Req() request: Request) {
    return this.configuration.rollback(category, version, body.reason, request.principal, request);
  }
}
