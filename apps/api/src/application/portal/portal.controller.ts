import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { RequesterListDto } from "./portal.dto.js";
import { PortalService } from "./portal.service.js";

@UseGuards(AuthGuard)
@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}
  @Get("session") session(@Req() request:Request){ return this.portal.session(request.principal); }
  @Get("requester/dashboard") dashboard(@Req() request:Request){ return this.portal.requesterSummary(request.principal); }
  @Get("requester/requests") list(@Req() request:Request,@Query() query:RequesterListDto){ return this.portal.requesterList(request.principal,query); }
  @Get("requester/requests/:id") detail(@Req() request:Request,@Param("id",ParseUUIDPipe) id:string){ return this.portal.requesterDetail(request.principal,id); }
}
