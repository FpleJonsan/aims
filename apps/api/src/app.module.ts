import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import path from "node:path";
import { AuthGuard } from "./application/auth/auth.guard.js";
import { PaymentDocumentService } from "./application/documents/payment-document.service.js";
import { DOCUMENT_STORAGE } from "./application/documents/tokens.js";
import { PaymentRequestController } from "./application/payment-requests/payment-request.controller.js";
import { PaymentRequestService } from "./application/payment-requests/payment-request.service.js";
import { FinanceContextController } from "./application/finance-context/finance-context.controller.js";
import { FinanceContextService } from "./application/finance-context/finance-context.service.js";
import { FinancialAnalysisController } from "./application/financial-analysis/financial-analysis.controller.js";
import { FinancialAnalysisService } from "./application/financial-analysis/financial-analysis.service.js";
import { PolicyController } from "./application/policy/policy.controller.js";
import { PolicyService } from "./application/policy/policy.service.js";
import { FinanceControlController } from "./application/finance-control/finance-control.controller.js";
import { FinanceControlService } from "./application/finance-control/finance-control.service.js";
import { PaymentController } from "./application/payments/payment.controller.js";
import { PaymentService } from "./application/payments/payment.service.js";
import { DashboardController } from "./application/dashboard/dashboard.controller.js";
import { DashboardService } from "./application/dashboard/dashboard.service.js";
import { FinanceIntelligenceController } from "./application/finance-intelligence/finance-intelligence.controller.js";
import { FinanceIntelligenceService } from "./application/finance-intelligence/finance-intelligence.service.js";
import {
  ApprovalController,
  TelegramWebhookController,
} from "./application/approval/approval.controller.js";
import { ApprovalService } from "./application/approval/approval.service.js";
import { ApprovalOutboxService } from "./application/approval/approval-outbox.service.js";
import {
  APPROVAL_CHANNEL,
  DisabledApprovalChannel,
  TelegramApprovalChannel,
} from "./application/approval/telegram-approval.channel.js";
import { ValidationController } from "./application/validation/validation.controller.js";
import {
  AI_PROVIDER,
  ValidationService,
} from "./application/validation/validation.service.js";
import { OpenAiCompatibleProvider } from "./infrastructure/ai/openai-compatible-provider.js";
import { Postgres } from "./infrastructure/database/postgres.js";
import { correlationMiddleware } from "./infrastructure/http/correlation.middleware.js";
import {
  LocalDocumentStorage,
  loadLocalStorageConfig,
} from "./infrastructure/storage/local-document-storage.js";
import { HealthController } from "./application/health/health.controller.js";
import { HealthService } from "./application/health/health.service.js";
import { PortalController } from "./application/portal/portal.controller.js";
import { PortalService } from "./application/portal/portal.service.js";

@Module({
  controllers: [
    PaymentRequestController,
    ValidationController,
    FinanceContextController,
    FinancialAnalysisController,
    PolicyController,
    FinanceControlController,
    ApprovalController,
    TelegramWebhookController,
    PaymentController,
    DashboardController,
    FinanceIntelligenceController,
    HealthController,
    PortalController,
  ],
  providers: [
    Postgres,
    AuthGuard,
    PaymentRequestService,
    PaymentDocumentService,
    ValidationService,
    FinanceContextService,
    FinancialAnalysisService,
    PolicyService,
    FinanceControlService,
    ApprovalService,
    ApprovalOutboxService,
    PaymentService,
    DashboardService,
    FinanceIntelligenceService,
    HealthService,
    PortalService,
    {
      provide: APPROVAL_CHANNEL,
      useFactory: () => {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        return process.env.TELEGRAM_APPROVAL_ENABLED === "true" && token
          ? new TelegramApprovalChannel(token)
          : new DisabledApprovalChannel();
      },
    },
    {
      provide: AI_PROVIDER,
      useFactory: () =>
        process.env.OPENAI_API_KEY
          ? new OpenAiCompatibleProvider(
              process.env.OPENAI_API_KEY,
              process.env.OPENAI_MODEL ?? "gpt-5-mini",
              process.env.OPENAI_BASE_URL,
            )
          : null,
    },
    {
      provide: DOCUMENT_STORAGE,
      useFactory: () => {
        const cwd = process.cwd();
        const applicationRoot = cwd.endsWith(`${path.sep}apps${path.sep}api`)
          ? path.resolve(cwd, "../..")
          : cwd;
        return new LocalDocumentStorage(
          loadLocalStorageConfig(process.env, applicationRoot),
        );
      },
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware).forRoutes("*");
  }
}
