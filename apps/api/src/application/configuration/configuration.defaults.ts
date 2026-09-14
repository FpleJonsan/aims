import type { ConfigurationCategory, NumberingDocumentType, NumberingRule } from "./configuration.types.js";

const defaultNumberingRule = (prefix: string): NumberingRule => ({
  prefix,
  includeCompanyPrefix: false,
  companyPrefix: null,
  includeDepartmentPrefix: false,
  includeYear: true,
  includeMonth: false,
  sequenceLength: 5,
  leadingZero: true,
  restartYearly: true,
  restartMonthly: false,
});

const NUMBERING_DEFAULT_PREFIXES: Record<NumberingDocumentType, string> = {
  PAYMENT_REQUEST: "PR",
  CLAIM: "CLM",
  APPROVAL: "APR",
  PAYMENT: "PAY",
  SUPPORT: "SUP",
};

/**
 * Returned by GET :category whenever nothing has ever been published, so
 * every settings screen always has something sensible to render. These are
 * pre-fill values only — Module 9 validation still applies at publish time,
 * so a default containing a null master-data reference simply cannot be
 * published until Finance Master supplies one.
 */
export function defaultPayloadFor(category: ConfigurationCategory): Record<string, unknown> {
  switch (category) {
    case "company":
      return {
        companyName: "",
        companyLogoUrl: null,
        companyAddress: "",
        registrationNumber: "",
        taxNumber: "",
        timezone: "Asia/Kuala_Lumpur",
        language: "en",
        workingDays: [1, 2, 3, 4, 5],
        publicHolidays: [],
        financialYearStartMonth: 1,
        defaultCurrencyId: null,
      };
    case "finance":
      return {
        defaultDepartmentId: null,
        defaultCategoryId: null,
        defaultProjectId: null,
        defaultCurrencyId: null,
        defaultPaymentMethodId: null,
        budgetYear: new Date().getUTCFullYear(),
        budgetLockDate: null,
        financeCalendar: "CALENDAR_YEAR",
        reminderDays: 3,
        overdueGracePeriodDays: 2,
        maximumClaimAmount: 10000,
        maximumPaymentAmount: 50000,
        maximumClaimItems: 20,
        maximumAttachments: 10,
        maximumAttachmentSizeMb: 10,
        allowedAttachmentTypes: ["pdf", "jpg", "jpeg", "png"],
        financeRemarkTemplates: [],
      };
    case "workflow":
      return {
        stageModel: "FIXED_12_STAGE",
        stageCount: 12,
        approvalRoutingAuthority: "APPROVAL_MATRIX",
        notificationAuthority: "NOTIFICATION_CONFIGURATION",
      };
    case "numbering":
      return {
        documentTypes: Object.fromEntries(
          (Object.keys(NUMBERING_DEFAULT_PREFIXES) as NumberingDocumentType[]).map((type) => [
            type,
            defaultNumberingRule(NUMBERING_DEFAULT_PREFIXES[type]),
          ]),
        ),
      };
    case "ai":
      return {
        enabled: false,
        provider: "openai-compatible",
        model: "gpt-5-mini",
        temperature: 0.2,
        maxTokens: 4096,
        apiKeyReference: "OPENAI_API_KEY",
        validationAiEnabled: false,
        documentExtractionEnabled: false,
        documentValidationEnabled: false,
        financialAnalysisAiEnabled: false,
        financialRiskAnalysisEnabled: false,
        spendingPatternAnalysisEnabled: false,
        complianceAnalysisEnabled: false,
        financeWatchEnabled: false,
        askAimsEnabled: false,
        manualModeAlwaysAvailable: true,
      };
    case "notifications":
      return {
        telegramEnabled: false,
        telegramReminderEnabled: false,
        telegramEscalationEnabled: false,
        notificationTemplates: [],
        reminderFrequencyHours: 24,
        escalationTimingHours: 72,
      };
    case "system":
      return {
        dashboardRefreshIntervalSeconds: 60,
        reminderIntervalMinutes: 60,
        overdueThresholdDays: 5,
        aiEnabled: false,
        telegramEnabled: false,
        maximumUploadSizeMb: 10,
        maximumUploadCount: 10,
        allowedFileTypes: ["pdf", "jpg", "jpeg", "png"],
        sessionTimeoutMinutes: 30,
      };
  }
}
