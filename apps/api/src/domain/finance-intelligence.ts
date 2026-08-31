import { z } from "zod";
import { createHash } from "node:crypto";

export const FINANCE_ANALYTICS_VERSION = "finance-dashboard:v1";
export const FINANCE_WATCH_PROMPT_VERSION = "finance-watch:v2/schema:v1";
export const ASK_AIMS_PROMPT_VERSION = "ask-aims:v2/schema:v1";
export const FINANCE_INTELLIGENCE_RESPONSE_SCHEMA_VERSION =
  "finance-intelligence-schema-v1";
export const InsightEvidenceSchema = z
  .object({
    metric: z.string().min(1).max(120),
    reference: z.string().min(1).max(300),
    value: z.union([z.string(), z.number()]),
  })
  .strict();
export const FinanceInsightSchema = z
  .object({
    type: z.enum([
      "BUDGET_PRESSURE",
      "CATEGORY_SPENDING",
      "SPENDING_PATTERN",
      "VENDOR_CONCENTRATION",
      "WORKFLOW_BOTTLENECK",
      "PAYMENT_BEHAVIOR",
      "PROCESS_IMPROVEMENT",
    ]),
    severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH"]),
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(2000),
    evidence: z.array(InsightEvidenceSchema).min(1).max(12),
    suggestedAction: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export const FinanceWatchOutputSchema = z
  .object({
    insights: z.array(FinanceInsightSchema).max(20),
    limitations: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const AskAimsOutputSchema = z
  .object({
    answer: z.string().min(1).max(3000),
    keyFindings: z.array(z.string().max(1000)).max(10),
    evidenceReferences: z.array(InsightEvidenceSchema).min(1).max(20),
    relatedEntities: z
      .array(
        z
          .object({
            type: z.enum([
              "PAYMENT",
              "PAYMENT_REQUEST",
              "DEPARTMENT",
              "CATEGORY",
            ]),
            id: z.string().max(200),
            label: z.string().max(300),
          })
          .strict(),
      )
      .max(20),
    dataPeriod: z.string().max(200),
    limitations: z.array(z.string().max(500)).max(10),
  })
  .strict();
export type FinanceWatchOutput = z.infer<typeof FinanceWatchOutputSchema>;
export type AskAimsOutput = z.infer<typeof AskAimsOutputSchema>;
export type InsightEvidence = z.infer<typeof InsightEvidenceSchema>;
export function payeeEvidenceReference(payee: string) {
  const normalized = payee
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ");
  return `PAYEE:${createHash("sha256").update(normalized).digest("hex")}`;
}

export function validateEvidence<
  T extends {
    evidence?: Array<{ metric: string; reference: string }>;
    evidenceReferences?: Array<{ metric: string; reference: string }>;
  },
>(output: T, allowed: Set<string> | Map<string, string>) {
  const evidence = output.evidence ?? output.evidenceReferences ?? [];
  for (const item of evidence) {
    const key = `${item.metric}:${item.reference}`;
    if (!allowed.has(key)) throw new Error("FABRICATED_EVIDENCE_REFERENCE");
    if (
      allowed instanceof Map &&
      allowed.get(key) !== String((item as { value?: unknown }).value)
    )
      throw new Error("EVIDENCE_VALUE_MISMATCH");
    if (/bank/i.test(item.metric) || /bank/i.test(item.reference))
      throw new Error("SENSITIVE_EVIDENCE_REJECTED");
  }
  const insightType = (output as { type?: string }).type;
  if (
    insightType === "VENDOR_CONCENTRATION" &&
    !evidence.some((x) => x.reference.startsWith("PAYEE:"))
  )
    throw new Error("VENDOR_EVIDENCE_REQUIRED");
  if (
    insightType === "CATEGORY_SPENDING" &&
    !evidence.some((x) => x.reference.startsWith("CATEGORY:"))
  )
    throw new Error("CATEGORY_EVIDENCE_REQUIRED");
  return output;
}
