import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  AskAimsDto,
  IntelligenceFilterDto,
} from "./finance-intelligence.dto.js";
import { FinanceIntelligenceService } from "./finance-intelligence.service.js";
@UseGuards(AuthGuard)
@Controller("finance-intelligence")
export class FinanceIntelligenceController {
  constructor(private readonly service: FinanceIntelligenceService) {}
  @Post("watch") watch(@Req() r: Request, @Body() b: IntelligenceFilterDto) {
    return this.service.watch(r.principal, b);
  }
  @Get("watch") latest(@Req() r: Request, @Query() q: IntelligenceFilterDto) {
    return this.service.latest(r.principal, q);
  }
  @Get("watch/history") history(
    @Req() r: Request,
    @Query() q: IntelligenceFilterDto,
  ) {
    return this.service.history(r.principal, q);
  }
  @Post("ask") ask(@Req() r: Request, @Body() b: AskAimsDto) {
    return this.service.ask(r.principal, b);
  }
}
