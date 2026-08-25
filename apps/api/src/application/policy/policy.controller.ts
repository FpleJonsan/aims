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
  CreatePolicyRuleDto,
  CreatePolicySetDto,
  CreatePolicyVersionDto,
  PolicyJustificationDto,
} from "./policy.dto.js";
import { PolicyService } from "./policy.service.js";
@UseGuards(AuthGuard)
@Controller()
export class PolicyController {
  constructor(private readonly service: PolicyService) {}
  @Post("payment-requests/:id/policy-evaluation") evaluate(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.evaluate(id, r.principal, r.correlationId);
  }
  @Get("payment-requests/:id/policy-evaluation") get(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(id, r.principal, false);
  }
  @Get("payment-requests/:id/policy-evaluation/history") history(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.get(id, r.principal, true);
  }
  @Post("payment-requests/:id/policy-clarifications/:exceptionId/respond")
  justify(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("exceptionId", ParseUUIDPipe) exceptionId: string,
    @Body() b: PolicyJustificationDto,
  ) {
    return this.service.justify(
      id,
      exceptionId,
      b,
      r.principal,
      r.correlationId,
    );
  }
  @Get("policies") list(@Req() r: Request) {
    return this.service.list(r.principal);
  }
  @Post("policies") create(@Req() r: Request, @Body() b: CreatePolicySetDto) {
    return this.service.createSet(b, r.principal, r.correlationId);
  }
  @Post("policies/:id/versions") version(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CreatePolicyVersionDto,
  ) {
    return this.service.createVersion(id, b, r.principal, r.correlationId);
  }
  @Post("policy-versions/:id/rules") rule(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CreatePolicyRuleDto,
  ) {
    return this.service.addRule(id, b, r.principal, r.correlationId);
  }
  @Post("policy-versions/:id/activate") activate(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.activate(id, r.principal, r.correlationId);
  }
  @Post("policy-versions/:id/retire") retire(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.service.retire(id, r.principal, r.correlationId);
  }
}
