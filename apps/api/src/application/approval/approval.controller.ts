import {
  Body,
  Controller,
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
  TelegramBindingDto,
} from "./approval.dto.js";
import { ApprovalOutboxService } from "./approval-outbox.service.js";
import { ApprovalService } from "./approval.service.js";

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
    return this.approvals.create(id, r.principal, r.correlationId);
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
    return this.approvals.act(id, stepId, b, r.principal, r.correlationId);
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
    @Body() b: TelegramBindingDto,
  ) {
    return this.approvals.bindTelegram(b, r.principal, r.correlationId);
  }
  @Post("approval-notifications/dispatch") dispatch(@Req() r: Request) {
    if (!r.principal.roles.some((x) => x === "FINANCE" || x === "ADMIN"))
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
    return this.approvals.telegramWebhook(secret, body);
  }
}
