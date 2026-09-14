import type { ConfigurationCategory, NumberingRule, Queryable } from "./configuration.types.js";
import { NUMBERING_DOCUMENT_TYPES } from "./configuration.types.js";

const IANA_TZ = /^[A-Za-z]+\/[A-Za-z_]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

async function masterDataExists(client: Queryable, table: string, id: unknown): Promise<boolean> {
  if (typeof id !== "string" || !id) return false;
  const result = await client.query(`SELECT 1 FROM ${table} WHERE id=$1 AND deleted_at IS NULL AND active=true`, [id]);
  return Boolean(result.rowCount);
}

/**
 * Module 9 — Configuration Validation. Every validator receives the exact
 * candidate payload (draft, or a historical version being rolled back to)
 * plus a DB handle for Master Data existence checks, and returns a flat list
 * of human-readable problems. An empty list means the payload may be
 * published; publish() refuses to proceed otherwise.
 */
export async function validateConfigurationPayload(
  category: ConfigurationCategory,
  payload: unknown,
  client: Queryable,
): Promise<string[]> {
  if (!isRecord(payload)) return ["Configuration payload must be an object"];
  switch (category) {
    case "company":
      return validateCompany(payload, client);
    case "finance":
      return validateFinance(payload, client);
    case "numbering":
      return validateNumbering(payload);
    case "ai":
      return validateAi(payload);
    case "notifications":
      return validateNotifications(payload);
    case "system":
      return validateSystem(payload);
  }
}

async function validateCompany(payload: Record<string, unknown>, client: Queryable): Promise<string[]> {
  const errors: string[] = [];
  if (typeof payload.companyName !== "string" || !payload.companyName.trim()) errors.push("Company name is required");
  if (typeof payload.companyAddress !== "string" || !payload.companyAddress.trim()) errors.push("Company address is required");
  if (typeof payload.registrationNumber !== "string" || !payload.registrationNumber.trim()) errors.push("Registration number is required");
  if (typeof payload.taxNumber !== "string" || !payload.taxNumber.trim()) errors.push("Tax number is required");
  if (typeof payload.timezone !== "string" || !IANA_TZ.test(payload.timezone)) errors.push("Timezone must be a valid IANA timezone (e.g. Asia/Kuala_Lumpur)");
  if (typeof payload.language !== "string" || !payload.language.trim()) errors.push("Language is required");
  if (!Array.isArray(payload.workingDays) || payload.workingDays.length === 0 || !payload.workingDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    errors.push("Working days must be a non-empty list of weekday numbers (0=Sunday..6=Saturday)");
  if (!Array.isArray(payload.publicHolidays) || !payload.publicHolidays.every((h) => isRecord(h) && typeof h.date === "string" && ISO_DATE.test(h.date) && typeof h.name === "string" && h.name.trim()))
    errors.push("Public holidays must each have a valid ISO date and a name");
  if (!Number.isInteger(payload.financialYearStartMonth) || (payload.financialYearStartMonth as number) < 1 || (payload.financialYearStartMonth as number) > 12)
    errors.push("Financial year start month must be between 1 and 12");
  if (typeof payload.defaultCurrencyId !== "string" || !payload.defaultCurrencyId) errors.push("Default currency is required");
  else if (!(await masterDataExists(client, "master_data_currencies", payload.defaultCurrencyId))) errors.push("Default currency does not exist or is not active in Master Data");
  return errors;
}

async function validateFinance(payload: Record<string, unknown>, client: Queryable): Promise<string[]> {
  const errors: string[] = [];
  const referenceChecks: Array<[string, string, string]> = [
    ["defaultDepartmentId", "master_data_departments", "Default department"],
    ["defaultCategoryId", "master_data_categories", "Default category"],
    ["defaultProjectId", "master_data_projects", "Default project"],
    ["defaultCurrencyId", "master_data_currencies", "Default currency"],
    ["defaultPaymentMethodId", "master_data_payment_methods", "Default payment method"],
  ];
  for (const [field, table, label] of referenceChecks) {
    const value = payload[field];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || !(await masterDataExists(client, table, value))) errors.push(`${label} does not exist or is not active in Master Data`);
  }
  if (!Number.isInteger(payload.budgetYear) || (payload.budgetYear as number) < 2000 || (payload.budgetYear as number) > 2100) errors.push("Budget year must be a valid year");
  if (payload.budgetLockDate !== null && payload.budgetLockDate !== undefined) {
    if (typeof payload.budgetLockDate !== "string" || !ISO_DATE.test(payload.budgetLockDate)) errors.push("Budget lock date must be a valid ISO date");
    else if (Number.isInteger(payload.budgetYear) && Number(payload.budgetLockDate.slice(0, 4)) !== payload.budgetYear)
      errors.push("Budget lock date must fall within the budget year");
  }
  if (payload.financeCalendar !== "CALENDAR_YEAR" && payload.financeCalendar !== "CUSTOM") errors.push("Finance calendar must be CALENDAR_YEAR or CUSTOM");
  for (const [field, label] of [
    ["reminderDays", "Reminder days"],
    ["overdueGracePeriodDays", "Overdue grace period"],
    ["maximumClaimItems", "Maximum claim items"],
    ["maximumAttachments", "Maximum attachments"],
    ["maximumAttachmentSizeMb", "Maximum attachment size"],
  ] as const) {
    if (!Number.isInteger(payload[field]) || (payload[field] as number) < 0) errors.push(`${label} must be a non-negative whole number`);
  }
  for (const [field, label] of [
    ["maximumClaimAmount", "Maximum claim amount"],
    ["maximumPaymentAmount", "Maximum payment amount"],
  ] as const) {
    if (!isFiniteNumber(payload[field]) || (payload[field] as number) <= 0) errors.push(`${label} must be a positive number`);
  }
  if (isFiniteNumber(payload.maximumClaimAmount) && isFiniteNumber(payload.maximumPaymentAmount) && (payload.maximumClaimAmount as number) > (payload.maximumPaymentAmount as number))
    errors.push("Maximum claim amount cannot exceed maximum payment amount");
  if (!Array.isArray(payload.allowedAttachmentTypes) || payload.allowedAttachmentTypes.length === 0 || !payload.allowedAttachmentTypes.every((t) => typeof t === "string" && t.trim()))
    errors.push("Allowed attachment types must be a non-empty list");
  if (!Array.isArray(payload.financeRemarkTemplates) || !payload.financeRemarkTemplates.every((t) => isRecord(t) && typeof t.code === "string" && t.code.trim() && typeof t.text === "string" && t.text.trim()))
    errors.push("Finance remark templates must each have a code and text");
  else {
    const codes = (payload.financeRemarkTemplates as Array<{ code: string }>).map((t) => t.code.trim().toLowerCase());
    if (new Set(codes).size !== codes.length) errors.push("Finance remark template codes must be unique");
  }
  return errors;
}

function isNumberingRule(value: unknown): value is NumberingRule {
  return (
    isRecord(value) &&
    typeof value.prefix === "string" &&
    value.prefix.trim().length > 0 &&
    typeof value.includeCompanyPrefix === "boolean" &&
    typeof value.includeDepartmentPrefix === "boolean" &&
    typeof value.includeYear === "boolean" &&
    typeof value.includeMonth === "boolean" &&
    Number.isInteger(value.sequenceLength) &&
    (value.sequenceLength as number) >= 1 &&
    (value.sequenceLength as number) <= 10 &&
    typeof value.leadingZero === "boolean" &&
    typeof value.restartYearly === "boolean" &&
    typeof value.restartMonthly === "boolean"
  );
}

function numberingSignature(rule: NumberingRule): string {
  return [rule.prefix.trim().toUpperCase(), rule.includeCompanyPrefix ? rule.companyPrefix?.trim().toUpperCase() ?? "" : "", rule.includeYear, rule.includeMonth].join("|");
}

function validateNumbering(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const documentTypes = payload.documentTypes;
  if (!isRecord(documentTypes)) return ["Numbering rules must include a documentTypes object"];
  const signatures = new Map<string, string>();
  for (const type of NUMBERING_DOCUMENT_TYPES) {
    const rule = documentTypes[type];
    if (!isNumberingRule(rule)) {
      errors.push(`Numbering rule for ${type} is missing or invalid`);
      continue;
    }
    if (rule.includeCompanyPrefix && (!rule.companyPrefix || !rule.companyPrefix.trim())) errors.push(`${type}: company prefix is required when "include company prefix" is enabled`);
    const signature = numberingSignature(rule);
    const collidingType = signatures.get(signature);
    if (collidingType) errors.push(`${type} and ${collidingType} produce identical document numbers — duplicate numbering rule`);
    else signatures.set(signature, type);
  }
  return errors;
}

function validateAi(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof payload.enabled !== "boolean") errors.push("AI enabled flag must be true or false");
  if (typeof payload.provider !== "string" || !payload.provider.trim()) errors.push("AI provider is required");
  if (typeof payload.model !== "string" || !payload.model.trim()) errors.push("AI model is required");
  if (!isFiniteNumber(payload.temperature) || (payload.temperature as number) < 0 || (payload.temperature as number) > 2) errors.push("Temperature must be between 0 and 2");
  if (!Number.isInteger(payload.maxTokens) || (payload.maxTokens as number) < 1 || (payload.maxTokens as number) > 32000) errors.push("Max tokens must be between 1 and 32000");
  if (payload.apiKeyReference !== null && (typeof payload.apiKeyReference !== "string" || !payload.apiKeyReference.trim())) errors.push("API key reference must be a non-empty pointer name, never the key itself");
  if (typeof payload.validationAiEnabled !== "boolean") errors.push("Validation AI flag must be true or false");
  if (typeof payload.financialAnalysisAiEnabled !== "boolean") errors.push("Financial analysis AI flag must be true or false");
  if (payload.manualModeAlwaysAvailable !== true) errors.push("Manual mode must always remain available and cannot be disabled");
  if (payload.enabled === false && (payload.validationAiEnabled === true || payload.financialAnalysisAiEnabled === true))
    errors.push("Validation AI or Financial Analysis AI cannot be enabled while AI is disabled");
  return errors;
}

function validateNotifications(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const field of ["telegramEnabled", "telegramReminderEnabled", "telegramEscalationEnabled"] as const) {
    if (typeof payload[field] !== "boolean") errors.push(`${field} must be true or false`);
  }
  if (payload.telegramEnabled === false && (payload.telegramReminderEnabled === true || payload.telegramEscalationEnabled === true))
    errors.push("Telegram reminders or escalation cannot be enabled while Telegram is disabled");
  if (!Number.isInteger(payload.reminderFrequencyHours) || (payload.reminderFrequencyHours as number) < 1) errors.push("Reminder frequency must be a positive whole number of hours");
  if (!Number.isInteger(payload.escalationTimingHours) || (payload.escalationTimingHours as number) < 1) errors.push("Escalation timing must be a positive whole number of hours");
  if (Number.isInteger(payload.reminderFrequencyHours) && Number.isInteger(payload.escalationTimingHours) && (payload.escalationTimingHours as number) <= (payload.reminderFrequencyHours as number))
    errors.push("Escalation timing must be longer than the reminder frequency");
  if (!Array.isArray(payload.notificationTemplates) || !payload.notificationTemplates.every((t) => isRecord(t) && typeof t.code === "string" && t.code.trim() && typeof t.channel === "string" && t.channel.trim() && typeof t.text === "string" && t.text.trim()))
    errors.push("Notification templates must each have a code, channel, and text");
  return errors;
}

function validateSystem(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const positiveIntFields: Array<[string, string]> = [
    ["dashboardRefreshIntervalSeconds", "Dashboard refresh interval"],
    ["reminderIntervalMinutes", "Reminder interval"],
    ["overdueThresholdDays", "Overdue threshold"],
    ["maximumUploadSizeMb", "Maximum upload size"],
    ["maximumUploadCount", "Maximum upload count"],
    ["sessionTimeoutMinutes", "Session timeout"],
  ];
  for (const [field, label] of positiveIntFields) {
    if (!Number.isInteger(payload[field]) || (payload[field] as number) < 1) errors.push(`${label} must be a positive whole number`);
  }
  if (typeof payload.aiEnabled !== "boolean") errors.push("AI enabled flag must be true or false");
  if (typeof payload.telegramEnabled !== "boolean") errors.push("Telegram enabled flag must be true or false");
  if (!Array.isArray(payload.allowedFileTypes) || payload.allowedFileTypes.length === 0 || !payload.allowedFileTypes.every((t) => typeof t === "string" && t.trim()))
    errors.push("Allowed file types must be a non-empty list");
  return errors;
}
