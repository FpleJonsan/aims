import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluatePolicy,
  validateNoAmbiguity,
  type PolicyFacts,
  type PolicyRule,
} from "../src/domain/policy.js";
const facts: PolicyFacts = {
  amountMinor: 250000n,
  currency: "MYR",
  departmentId: "00000000-0000-4000-8000-000000000001",
  category: "Marketing",
  paymentMethod: "BANK_TRANSFER",
  riskLevel: "HIGH",
  priority: "HIGH",
  riskFlags: ["BUDGET_PRESSURE"],
  evidenceTypes: ["INVOICE"],
};
const rule = (x: Partial<PolicyRule>): PolicyRule => ({
  id: crypto.randomUUID(),
  code: "R1",
  priority: 100,
  effect: "REQUIRE_APPROVAL",
  conditions: {},
  approvalSteps: [
    {
      sequence: 1,
      requiredRole: "AM",
      authorityScope: "DEPARTMENT",
      mandatory: true,
      reason: "Threshold",
    },
  ],
  requiredEvidence: [],
  escalation: null,
  notificationMetadata: {},
  autoApprovalEligible: false,
  exceptionCode: null,
  exceptionReason: null,
  justificationRole: null,
  ...x,
});
test("evaluates amount department category and human-final risk deterministically", () => {
  const r = rule({
    conditions: {
      amountMinorMin: "200000",
      departmentIds: [facts.departmentId],
      categories: ["Marketing"],
      riskLevels: ["HIGH"],
    },
  });
  const result = evaluatePolicy([r], facts);
  assert.equal(result.result, "PASS");
  assert.equal(result.approvalPlan[0].requiredRole, "AM");
});
test("raw AI risk cannot influence policy facts", () => {
  const r = rule({ conditions: { riskLevels: ["MEDIUM"] } });
  assert.equal(evaluatePolicy([r], facts).matched.length, 0);
});
test("missing required evidence creates justification result", () => {
  const r = rule({ requiredEvidence: ["INVOICE", "CONTRACT"] });
  const result = evaluatePolicy([r], facts);
  assert.equal(result.result, "JUSTIFICATION_REQUIRED");
  assert.deepEqual(result.missingEvidence, ["CONTRACT"]);
});
test("policy-only auto approval eligibility does not create approval", () => {
  const r = rule({
    effect: "ALLOW_NO_APPROVAL",
    approvalSteps: [],
    autoApprovalEligible: true,
  });
  const result = evaluatePolicy([r], facts);
  assert.equal(result.autoApprovalEligible, true);
  assert.equal(result.approvalRequired, false);
});
test("exception precedence wins and requires justification", () => {
  const normal = rule({ code: "NORMAL", priority: 200 }),
    exception = rule({
      code: "EX",
      priority: 10,
      effect: "REQUIRE_JUSTIFICATION",
      approvalSteps: [],
      exceptionCode: "HIGH_RISK",
      exceptionReason: "Explain high risk",
      justificationRole: "FINANCE",
    });
  assert.equal(
    evaluatePolicy([normal, exception], facts).result,
    "JUSTIFICATION_REQUIRED",
  );
});
test("ambiguous equal-priority conflicting rules are rejected", () => {
  assert.throws(
    () =>
      validateNoAmbiguity([
        rule({ code: "A" }),
        rule({ code: "B", effect: "ALLOW_NO_APPROVAL", approvalSteps: [] }),
      ]),
    /Ambiguous/,
  );
});
test("risk-flag conflicts and duplicate approval sequences are rejected", () => {
  const flagged = rule({
      code: "FLAG-A",
      conditions: { riskFlagsAny: ["DUPLICATE_VENDOR"] },
    }),
    contradictory = rule({
      code: "FLAG-B",
      effect: "ALLOW_NO_APPROVAL",
      approvalSteps: [],
      conditions: { riskFlagsAny: ["DUPLICATE_VENDOR"] },
    });
  assert.throws(
    () => validateNoAmbiguity([flagged, contradictory]),
    /Ambiguous/,
  );
  assert.throws(
    () =>
      validateNoAmbiguity([
        rule({
          code: "SEQ",
          approvalSteps: [
            {
              sequence: 1,
              requiredRole: "AM",
              authorityScope: "DEPARTMENT",
              mandatory: true,
              reason: "A",
            },
            {
              sequence: 1,
              requiredRole: "DIRECTOR",
              authorityScope: "ORGANIZATION",
              mandatory: true,
              reason: "B",
            },
          ],
        }),
      ]),
    /Duplicate approval sequence/,
  );
});
