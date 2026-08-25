import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  FinanceConfirmationDto,
  FinanceFinalizeDto,
  FinanceHoldResolutionDto,
} from "./finance-control.dto.js";
import { FinanceControlService } from "./finance-control.service.js";

@UseGuards(AuthGuard)
@Controller()
export class FinanceControlController {
  constructor(private readonly service: FinanceControlService) {}
  @Get("finance-control") list(@Req() r: Request) {
    return this.service.list(r.principal);
  }
  @Post("payment-requests/:id/finance-control") start(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.start(id, r.principal, r.correlationId);
  }
  @Get("payment-requests/:id/finance-control") get(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(id, r.principal);
  }
  @Get("payment-requests/:id/finance-control/history") history(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.history(id, r.principal);
  }
  @Post("finance-control/:id/checks") confirm(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: FinanceConfirmationDto,
  ) {
    return this.service.confirm(id, body, r.principal, r.correlationId);
  }
  @Post("finance-control/:id/finalize") finalize(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: FinanceFinalizeDto,
  ) {
    return this.service.finalize(id, body, r.principal, r.correlationId);
  }
  @Post("finance-control/:id/hold/resolve") resolve(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: FinanceHoldResolutionDto,
  ) {
    return this.service.resolve(id, body, r.principal, r.correlationId);
  }
}
