import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  ApprovalActionDto,
  ApprovalClarificationResponseDto,
  ApprovalInboxDto,
  TelegramBindingChallengeDto,
} from "./approval.dto.js";
import { ApprovalOutboxService } from "./approval-outbox.service.js";
import { ApprovalService } from "./approval.service.js";
import {observeOperation} from "../../infrastructure/observability/telemetry.js";

@UseGuards(AuthGuard)
@Controller()
export class ApprovalController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly outbox: ApprovalOutboxService,
  ) {}
  @Post("payment-requests/:id/approval") create(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return observeOperation("APPROVAL_CREATE","WEB",r.correlationId,()=>this.approvals.create(id, r.principal, r.correlationId));
  }
  @Get("payment-requests/:id/approval") get(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.approvals.get(id, r.principal);
  }
  @Get("approvals") list(@Req() r: Request, @Query() q: ApprovalInboxDto) {
    return this.approvals.list(r.principal, q);
  }
  @Post("payment-requests/:id/approval/steps/:stepId/actions") act(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("stepId", ParseUUIDPipe) stepId: string,
    @Body() b: ApprovalActionDto,
  ) {
    return observeOperation("APPROVAL_ACTION","WEB",r.correlationId,()=>this.approvals.act(id, stepId, b, r.principal, r.correlationId));
  }
  @Post("payment-requests/:id/approval-clarifications/:clarificationId/respond")
  respond(
    @Req() r: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("clarificationId", ParseUUIDPipe) clarificationId: string,
    @Body() b: ApprovalClarificationResponseDto,
  ) {
    return this.approvals.respond(
      id,
      clarificationId,
      b,
      r.principal,
      r.correlationId,
    );
  }
  @Post("integrations/telegram/bindings") bind(
    @Req() r: Request,
    @Body() b: TelegramBindingChallengeDto,
  ) {
    return this.approvals.createTelegramBindingChallenge(
      b.userId,
      r.principal,
      r.correlationId,
    );
  }
  @Delete("integrations/telegram/bindings/:userId") revoke(
    @Req() r: Request,
    @Param("userId", ParseUUIDPipe) userId: string,
  ) {
    return this.approvals.revokeTelegram(userId, r.principal, r.correlationId);
  }
  @Post("approval-notifications/dispatch") dispatch(@Req() r: Request) {
    if (!r.principal.roles.includes("FINANCE"))
      throw new ForbiddenException("Finance permission required");
    return this.outbox.dispatch();
  }
}

@Controller("integrations/telegram")
export class TelegramWebhookController {
  constructor(private readonly approvals: ApprovalService) {}
  @Post("webhook") webhook(
    @Headers("x-telegram-bot-api-secret-token") secret: string | undefined,
    @Body() body: unknown,
  ) {
    return observeOperation("TELEGRAM_WEBHOOK","TELEGRAM",undefined,()=>this.approvals.telegramWebhook(secret, body));
  }
}
