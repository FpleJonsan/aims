import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { FinanceMasterGuard } from "../auth/finance-master.guard.js";
import { NotificationBindingService } from "./notification-binding.service.js";
import { NotificationDispatcherService } from "./notification-dispatcher.service.js";
import { NotificationService } from "./notification.service.js";
import { TelegramInboundService } from "./telegram-inbound.service.js";
import { NotificationHistoryQueryDto, SetNotificationPreferenceDto } from "./notification.dto.js";

/**
 * Self-service Telegram binding and notification preferences. Binding
 * belongs to User Profile per the P20.5G brief: any authenticated user
 * manages only their own binding (NotificationBindingService.assertSelfOrAdmin
 * enforces this even if a route were ever mis-wired to accept a userId).
 */
@UseGuards(AuthGuard)
@Controller("profile")
export class NotificationProfileController {
  constructor(
    private readonly bindings: NotificationBindingService,
    private readonly notifications: NotificationService,
  ) {}

  @Get("telegram") status(@Req() r: Request) {
    return this.bindings.status(r.principal, r.principal.id);
  }
  @Post("telegram/challenge") challenge(@Req() r: Request) {
    return this.bindings.createChallenge(r.principal.id, r.principal, r.correlationId);
  }
  @Delete("telegram") unbind(@Req() r: Request) {
    return this.bindings.revoke(r.principal.id, r.principal, r.correlationId);
  }

  @Get("notifications") preferences(@Req() r: Request) {
    return this.notifications.getPreferences(r.principal);
  }
  @Put("notifications/:channel") setPreference(
    @Req() r: Request,
    @Param("channel") channel: string,
    @Body() body: SetNotificationPreferenceDto,
  ) {
    return this.notifications.setPreference(r.principal, channel, { enabled: body.enabled, mutedUntil: body.mutedUntil ?? null }, r);
  }
}

/**
 * Admin surface. Template authoring/versioning intentionally has no routes
 * here: it is served entirely by the existing admin/configuration/notifications
 * endpoints (ConfigurationController), reusing the Business Configuration
 * draft/preview/publish/version/rollback engine as-is. Finance Master may
 * view a user's Telegram binding status but cannot bind/unbind on their
 * behalf (no such route is exposed).
 */
@UseGuards(AuthGuard, FinanceMasterGuard)
@Controller("admin/notifications")
export class NotificationAdminController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly dispatcher: NotificationDispatcherService,
    private readonly bindings: NotificationBindingService,
  ) {}

  @Get() status() {
    return this.notifications.getStatus();
  }
  @Get("history") history(@Query() query: NotificationHistoryQueryDto) {
    return this.notifications.listHistory({
      page: Math.max(1, Number(query.page ?? 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 25))),
      eventType: query.eventType,
      status: query.status,
    });
  }
  @Post("dispatch") dispatch() {
    return this.dispatcher.dispatch();
  }
  @Get("telegram-bindings/:userId") bindingStatus(@Param("userId", ParseUUIDPipe) userId: string) {
    return this.bindings.adminViewStatus(userId);
  }
}

@Controller("integrations/telegram")
export class TelegramWebhookController {
  constructor(private readonly inbound: TelegramInboundService) {}
  @Post("webhook") webhook(@Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() body: unknown) {
    return this.inbound.telegramWebhook(secret, body);
  }
}
