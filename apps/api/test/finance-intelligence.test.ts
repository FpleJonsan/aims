import assert from "node:assert/strict";
import test from "node:test";
import {
  AskAimsOutputSchema,
  FinanceWatchOutputSchema,
  payeeEvidenceReference,
  validateEvidence,
} from "../src/domain/finance-intelligence.js";
const evidence = {
  metric: "financial.available",
  reference: "company",
  value: "100.00",
};
test("Finance Watch accepts strict evidence-backed output", () => {
  const x = FinanceWatchOutputSchema.parse({
    insights: [
      {
        type: "BUDGET_PRESSURE",
        severity: "MEDIUM",
        title: "Pressure",
        summary: "Available balance is narrowing.",
        evidence: [evidence],
        suggestedAction: "Review committed items.",
        confidence: 0.8,
      },
    ],
    limitations: [],
  });
  assert.equal(
    validateEvidence(x.insights[0], new Set(["financial.available:company"]))
      .title,
    "Pressure",
  );
});
test("Finance Watch rejects malformed or evidence-free output", () => {
  assert.equal(
    FinanceWatchOutputSchema.safeParse({
      insights: [
        {
          type: "BUDGET_PRESSURE",
          severity: "HIGH",
          title: "x",
          summary: "x",
          evidence: [],
          suggestedAction: "x",
          confidence: 0.5,
        },
      ],
      limitations: [],
    }).success,
    false,
  );
});
test("fabricated evidence is rejected", () => {
  const x = FinanceWatchOutputSchema.parse({
    insights: [
      {
        type: "SPENDING_PATTERN",
        severity: "LOW",
        title: "Pattern",
        summary: "Supported summary",
        evidence: [evidence],
        suggestedAction: "Review",
        confidence: 0.5,
      },
    ],
    limitations: [],
  });
  assert.throws(
    () =>
      validateEvidence(x.insights[0], new Set(["financial.actual:company"])),
    /FABRICATED/,
  );
});
test("Ask AIMS contract contains evidence and no action or SQL fields", () => {
  const x = AskAimsOutputSchema.parse({
    answer: "Available is MYR 100.",
    keyFindings: ["Available balance"],
    evidenceReferences: [evidence],
    relatedEntities: [],
    dataPeriod: "Current",
    limitations: [],
  });
  assert.equal("sql" in x, false);
  assert.equal("action" in x, false);
});
test("typed vendor and category evidence validates exact deterministic values", () => {
  const allowed = new Map([
    ["payee.shareBasisPoints:PAYEE:acme", "4200"],
    ["category.utilisationBasisPoints:CATEGORY:dept-1:advertising", "9100"],
  ]);
  const items = [
    { metric: "payee.shareBasisPoints", reference: "PAYEE:acme", value: 4200 },
    { metric: "category.utilisationBasisPoints", reference: "CATEGORY:dept-1:advertising", value: 9100 },
  ];
  for (const item of items) assert.doesNotThrow(() => validateEvidence({ evidence: [item] }, allowed));
  assert.throws(() => validateEvidence({ evidence: [{ ...items[0], reference: "PAYEE:invented" }] }, allowed), /FABRICATED/);
  assert.throws(() => validateEvidence({ evidence: [{ ...items[0], value: 9999 }] }, allowed), /MISMATCH/);
});
test("bank-reference evidence is rejected even if placed in the allowlist", () => {
  const item = { metric: "bank.reference", reference: "BANK:secret", value: "redacted" };
  assert.throws(() => validateEvidence({ evidence: [item] }, new Map([[`${item.metric}:${item.reference}`, item.value]])), /SENSITIVE/);
});
test("payee evidence identity is stable and collision-resistant",()=>{
  assert.equal(payeeEvidenceReference(" ACME  SDN BHD "),payeeEvidenceReference("acme sdn bhd"));
  assert.notEqual(payeeEvidenceReference("A&B"),payeeEvidenceReference("A B"));
  assert.match(payeeEvidenceReference("Sensitive Vendor"),/^PAYEE:[a-f0-9]{64}$/);
  assert.equal(payeeEvidenceReference("Sensitive Vendor").includes("sensitive"),false);
});
