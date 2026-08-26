import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { DashboardFilterDto, ReportingRequestFilterDto } from "./dashboard.dto.js";
import { DashboardService } from "./dashboard.service.js";
@UseGuards(AuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get("reporting-scope") scope(@Req() r: Request) {
    return this.dashboard.reportingScope(r.principal);
  }
  @Get("requests") requests(@Req() r: Request, @Query() q: ReportingRequestFilterDto) {
    return this.dashboard.reportingRequests(r.principal, q);
  }
  @Get("finance-summary") summary(
    @Req() r: Request,
    @Query() q: DashboardFilterDto,
  ) {
    return this.dashboard.summary(r.principal, q);
  }
  @Get("budget") budget(@Req() r: Request, @Query() q: DashboardFilterDto) {
    return this.dashboard.budget(r.principal, q);
  }
  @Get("spending-trend") trend(
    @Req() r: Request,
    @Query() q: DashboardFilterDto,
  ) {
    return this.dashboard.trend(r.principal, q);
  }
  @Get("workflow") workflow(@Req() r: Request, @Query() q: DashboardFilterDto) {
    return this.dashboard.workflow(r.principal, q);
  }
  @Get("ai-usage") usage(@Req() r: Request, @Query() q: DashboardFilterDto) {
    return this.dashboard.aiUsage(r.principal, q);
  }
}
