import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import path from "node:path";
import { AuthGuard } from "./application/auth/auth.guard.js";
import { LocalIdentityController } from "./application/auth/local-identity.controller.js";
import { PaymentDocumentService } from "./application/documents/payment-document.service.js";
import {
  DOCUMENT_MALWARE_SCANNER,
  DOCUMENT_STORAGE,
} from "./application/documents/tokens.js";
import { PaymentRequestController } from "./application/payment-requests/payment-request.controller.js";
import { PaymentRequestService } from "./application/payment-requests/payment-request.service.js";
import { ClaimItemController } from "./application/claim-items/claim-item.controller.js";
import { ClaimItemService } from "./application/claim-items/claim-item.service.js";
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
import { ApprovalController } from "./application/approval/approval.controller.js";
import { ApprovalService } from "./application/approval/approval.service.js";
import { ApprovalOutboxService } from "./application/approval/approval-outbox.service.js";
import { ApprovalReminderService } from "./application/approval/approval-reminder.service.js";
import {
  APPROVAL_CHANNEL,
  DisabledApprovalChannel,
  TelegramApprovalChannel,
} from "./application/approval/telegram-approval.channel.js";
import {
  NotificationAdminController,
  NotificationProfileController,
  TelegramWebhookController,
} from "./application/notification/notification.controller.js";
import { NotificationBindingService } from "./application/notification/notification-binding.service.js";
import { NotificationService } from "./application/notification/notification.service.js";
import { NotificationDispatcherService } from "./application/notification/notification-dispatcher.service.js";
import { TelegramInboundService } from "./application/notification/telegram-inbound.service.js";
import {
  DisabledNotificationChannel,
  NOTIFICATION_CHANNELS,
  TelegramNotificationChannel,
} from "./application/notification/notification-channel.js";
import { ValidationController } from "./application/validation/validation.controller.js";
import {
  AI_PROVIDER,
  ValidationService,
} from "./application/validation/validation.service.js";
import { createAiRuntimeProvider } from "./infrastructure/ai/ai-provider-factory.js";
import { Postgres } from "./infrastructure/database/postgres.js";
import { correlationMiddleware } from "./infrastructure/http/correlation.middleware.js";
import { HealthController } from "./application/health/health.controller.js";
import { HealthService } from "./application/health/health.service.js";
import { PortalController } from "./application/portal/portal.controller.js";
import { PortalService } from "./application/portal/portal.service.js";
import { SessionService } from "./application/auth/session.service.js";
import { loadTelegramConfig } from "./infrastructure/configuration/telegram-config.js";
import { httpObservabilityMiddleware } from "./infrastructure/observability/http-observability.middleware.js";
import { MetricsController } from "./application/health/metrics.controller.js";
import { createDocumentScanner, createDocumentStorage } from "./infrastructure/configuration/provider-boundary.js";
import { CorporateAuthController } from "./application/auth/corporate-auth.controller.js";
import { CorporateAuthService } from "./application/auth/corporate-auth.service.js";
import { CORPORATE_IDENTITY_PROVIDER, UnavailableCorporateIdentityProvider } from "./application/auth/corporate-identity.provider.js";
import { PasswordAuthController } from "./application/auth/password-auth.controller.js";
import { PasswordAuthService } from "./application/auth/password-auth.service.js";
import { EMAIL_SENDER, createEmailSender } from "./infrastructure/email/email-sender.js";
import { FinanceMasterGuard } from "./application/auth/finance-master.guard.js";
import { PermissionGuard } from "./application/auth/permission.guard.js";
import { UserManagementController } from "./application/user-management/user-management.controller.js";
import { UserManagementService } from "./application/user-management/user-management.service.js";
import { PermissionCatalogController, RoleController } from "./application/role-permission/role-permission.controller.js";
import { RolePermissionService } from "./application/role-permission/role-permission.service.js";
import {
  CategoriesController,
  CurrenciesController,
  MasterDataDepartmentsController,
  PaymentMethodsController,
  ProjectsController,
} from "./application/master-data/master-data.controller.js";
import { MasterDataService } from "./application/master-data/master-data.service.js";
import { ConfigurationController } from "./application/configuration/configuration.controller.js";
import { ConfigurationService } from "./application/configuration/configuration.service.js";
import { ProfileController } from "./application/profile/profile.controller.js";
import { ProfileService } from "./application/profile/profile.service.js";
import { AuditController } from "./application/audit/audit.controller.js";
import { AuditService } from "./application/audit/audit.service.js";
import { ApprovalMatrixController } from "./application/approval-matrix/approval-matrix.controller.js";
import { ApprovalMatrixService } from "./application/approval-matrix/approval-matrix.service.js";
import { ApprovalDelegationController } from "./application/approval-delegation/approval-delegation.controller.js";
import { ApprovalDelegationService } from "./application/approval-delegation/approval-delegation.service.js";
import {
  CATEGORIES_CONFIG,
  CATEGORIES_MASTER_DATA,
  CURRENCIES_CONFIG,
  CURRENCIES_MASTER_DATA,
  DEPARTMENTS_CONFIG,
  DEPARTMENTS_MASTER_DATA,
  PAYMENT_METHODS_CONFIG,
  PAYMENT_METHODS_MASTER_DATA,
  PROJECTS_CONFIG,
  PROJECTS_MASTER_DATA,
} from "./application/master-data/master-data.domains.js";

@Module({
  controllers: [
    LocalIdentityController,
    CorporateAuthController,
    PasswordAuthController,
    UserManagementController,
    RoleController,
    PermissionCatalogController,
    CategoriesController,
    MasterDataDepartmentsController,
    ProjectsController,
    CurrenciesController,
    PaymentMethodsController,
    ConfigurationController,
    ProfileController,
    AuditController,
    ApprovalMatrixController,
    ApprovalDelegationController,
    PaymentRequestController,
    ClaimItemController,
    ValidationController,
    FinanceContextController,
    FinancialAnalysisController,
    PolicyController,
    FinanceControlController,
    ApprovalController,
    NotificationProfileController,
    NotificationAdminController,
    TelegramWebhookController,
    PaymentController,
    DashboardController,
    FinanceIntelligenceController,
    HealthController,
    PortalController,
    MetricsController,
  ],
  providers: [
    Postgres,
    AuthGuard,
    SessionService,
    CorporateAuthService,
    { provide: CORPORATE_IDENTITY_PROVIDER, useFactory: () => new UnavailableCorporateIdentityProvider() },
    PasswordAuthService,
    { provide: EMAIL_SENDER, useFactory: () => createEmailSender(process.env) },
    FinanceMasterGuard,
    PermissionGuard,
    UserManagementService,
    RolePermissionService,
    { provide: CATEGORIES_MASTER_DATA, useFactory: (postgres: Postgres) => new MasterDataService(postgres, CATEGORIES_CONFIG), inject: [Postgres] },
    { provide: DEPARTMENTS_MASTER_DATA, useFactory: (postgres: Postgres) => new MasterDataService(postgres, DEPARTMENTS_CONFIG), inject: [Postgres] },
    { provide: PROJECTS_MASTER_DATA, useFactory: (postgres: Postgres) => new MasterDataService(postgres, PROJECTS_CONFIG), inject: [Postgres] },
    { provide: CURRENCIES_MASTER_DATA, useFactory: (postgres: Postgres) => new MasterDataService(postgres, CURRENCIES_CONFIG), inject: [Postgres] },
    { provide: PAYMENT_METHODS_MASTER_DATA, useFactory: (postgres: Postgres) => new MasterDataService(postgres, PAYMENT_METHODS_CONFIG), inject: [Postgres] },
    ConfigurationService,
    ProfileService,
    AuditService,
    ApprovalMatrixService,
    ApprovalDelegationService,
    PaymentRequestService,
    ClaimItemService,
    PaymentDocumentService,
    ValidationService,
    FinanceContextService,
    FinancialAnalysisService,
    PolicyService,
    FinanceControlService,
    ApprovalService,
    ApprovalOutboxService,
    ApprovalReminderService,
    NotificationBindingService,
    NotificationService,
    NotificationDispatcherService,
    TelegramInboundService,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: () => {
        const config = loadTelegramConfig(process.env);
        const channels = new Map();
        channels.set(
          "TELEGRAM",
          config.enabled ? new TelegramNotificationChannel(config.botToken!, config) : new DisabledNotificationChannel(),
        );
        return channels;
      },
    },
    PaymentService,
    DashboardService,
    FinanceIntelligenceService,
    HealthService,
    PortalService,
    {
      provide: APPROVAL_CHANNEL,
      useFactory: () => {
        const config = loadTelegramConfig(process.env);
        return config.enabled
          ? new TelegramApprovalChannel(config.botToken!, config)
          : new DisabledApprovalChannel();
      },
    },
    {
      provide: AI_PROVIDER,
      useFactory: () => createAiRuntimeProvider(process.env),
    },
    {
      provide: DOCUMENT_STORAGE,
      useFactory: () => {
        const cwd = process.cwd();
        const applicationRoot = cwd.endsWith(`${path.sep}apps${path.sep}api`)
          ? path.resolve(cwd, "../..")
          : cwd;
        return createDocumentStorage(process.env, applicationRoot);
      },
    },
    {
      provide: DOCUMENT_MALWARE_SCANNER,
      useFactory: () => {
        return createDocumentScanner(process.env);
      },
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationMiddleware, httpObservabilityMiddleware).forRoutes("*");
  }
}
