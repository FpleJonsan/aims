import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesRule,
  resolveApprovalMatrix,
  validateApprovalMatrixRules,
  type ApprovalMatrixFacts,
  type ApprovalMatrixRule,
} from "../src/domain/approval-matrix.js";

const facts: ApprovalMatrixFacts = {
  amountMinor: 250000n,
  currency: "MYR",
  departmentId: "00000000-0000-4000-8000-000000000001",
  category: "Marketing",
  projectIds: ["00000000-0000-4000-8000-0000000000aa"],
  paymentMethod: "BANK_TRANSFER",
  riskLevel: "HIGH",
  priority: "HIGH",
  claimCount: 2,
  asOfDate: "2026-06-01",
};

const step = (x: Partial<ApprovalMatrixRule["steps"][number]> = {}) => ({
  sequence: 1,
  parallelGroup: null,
  requiredApprovals: null,
  requiredRole: "AM",
  authorityScope: "DEPARTMENT" as const,
  mandatory: true,
  reason: "Threshold",
  ...x,
});

const rule = (x: Partial<ApprovalMatrixRule> = {}): ApprovalMatrixRule => ({
  id: crypto.randomUUID(),
  code: "R1",
  name: "Rule 1",
  priority: 100,
  active: true,
  isFallback: false,
  conditionLogic: "ALL",
  conditions: {},
  financeReviewRequired: false,
  aiAnalysisRequired: false,
  steps: [step()],
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  ...x,
});

test("matches on amount range, department, and risk level with ALL logic", () => {
  const r = rule({
    conditions: {
      amountMinorMin: "200000",
      departmentIds: [facts.departmentId],
      riskLevels: ["HIGH"],
    },
  });
  assert.equal(matchesRule(r, facts), true);
  assert.equal(matchesRule(r, { ...facts, riskLevel: "LOW" }), false);
});

test("ANY condition logic matches when at least one clause passes", () => {
  const r = rule({
    conditionLogic: "ANY",
    conditions: { riskLevels: ["LOW"], categories: { op: "EQUALS", values: ["Marketing"] } },
  });
  assert.equal(matchesRule(r, facts), true);
  assert.equal(matchesRule(r, { ...facts, category: "Travel", riskLevel: "HIGH" }), false);
});

test("CONTAINS / STARTS_WITH / ENDS_WITH string operators", () => {
  const contains = rule({ conditions: { categories: { op: "CONTAINS", values: ["arket"] } } });
  const startsWith = rule({ conditions: { categories: { op: "STARTS_WITH", values: ["Mar"] } } });
  const endsWith = rule({ conditions: { categories: { op: "ENDS_WITH", values: ["ing"] } } });
  const noMatch = rule({ conditions: { categories: { op: "STARTS_WITH", values: ["Zzz"] } } });
  assert.equal(matchesRule(contains, facts), true);
  assert.equal(matchesRule(startsWith, facts), true);
  assert.equal(matchesRule(endsWith, facts), true);
  assert.equal(matchesRule(noMatch, facts), false);
});

test("claim count range condition", () => {
  const r = rule({ conditions: { claimCountMin: 3 } });
  assert.equal(matchesRule(r, facts), false);
  assert.equal(matchesRule(r, { ...facts, claimCount: 5 }), true);
});

test("effective date window gates matching regardless of conditions", () => {
  const future = rule({ effectiveFrom: "2027-01-01" });
  const expired = rule({ effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
  assert.equal(matchesRule(future, facts), false);
  assert.equal(matchesRule(expired, facts), false);
});

test("inactive rules never match", () => {
  const r = rule({ active: false, conditions: {} });
  assert.equal(matchesRule(r, facts), false);
});

test("resolveApprovalMatrix picks the highest-priority (lowest number) matching rule", () => {
  const low = rule({ code: "LOW", priority: 10, conditions: { riskLevels: ["HIGH"] }, steps: [step({ reason: "low-priority-number wins" })] });
  const high = rule({ code: "HIGH", priority: 200, conditions: { riskLevels: ["HIGH"] }, steps: [step({ reason: "loses" })] });
  const resolution = resolveApprovalMatrix([high, low], facts);
  assert.equal(resolution?.rule.code, "LOW");
});

test("resolveApprovalMatrix falls back to the active fallback rule when nothing else matches", () => {
  const specific = rule({ code: "SPECIFIC", conditions: { departmentIds: ["not-this-department"] } });
  const fallback = rule({ code: "FALLBACK", isFallback: true, conditions: { departmentIds: ["not-this-department"] } });
  const resolution = resolveApprovalMatrix([specific, fallback], facts);
  assert.equal(resolution?.rule.code, "FALLBACK");
});

test("resolveApprovalMatrix returns null when nothing matches and there is no fallback", () => {
  const specific = rule({ conditions: { departmentIds: ["not-this-department"] } });
  assert.equal(resolveApprovalMatrix([specific], facts), null);
});

test("resolveApprovalMatrix sorts a winning rule's steps by sequence", () => {
  const r = rule({
    steps: [
      step({ sequence: 2, requiredRole: "SECOND" }),
      step({ sequence: 1, requiredRole: "FIRST" }),
    ],
  });
  const resolution = resolveApprovalMatrix([r], facts);
  assert.deepEqual(resolution?.steps.map((s) => s.requiredRole), ["FIRST", "SECOND"]);
});

test("validateApprovalMatrixRules rejects duplicate rule codes", () => {
  const errors = validateApprovalMatrixRules([rule({ code: "DUP" }), rule({ code: "DUP" })]);
  assert.ok(errors.some((e) => e.includes("Duplicate rule code")));
});

test("validateApprovalMatrixRules rejects invalid effective date ranges", () => {
  const errors = validateApprovalMatrixRules([rule({ effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" })]);
  assert.ok(errors.some((e) => e.includes("Invalid effective dates")));
});

test("validateApprovalMatrixRules rejects duplicate sequence without a parallel group", () => {
  const errors = validateApprovalMatrixRules([
    rule({ steps: [step({ sequence: 1, requiredRole: "A" }), step({ sequence: 1, requiredRole: "B" })] }),
  ]);
  assert.ok(errors.some((e) => e.includes("duplicate sequence without a parallel group")));
});

test("validateApprovalMatrixRules accepts a parallel group sharing one sequence", () => {
  const errors = validateApprovalMatrixRules([
    rule({
      steps: [
        step({ sequence: 1, parallelGroup: 1, requiredRole: "A" }),
        step({ sequence: 1, parallelGroup: 1, requiredRole: "B" }),
      ],
    }),
  ]);
  assert.deepEqual(errors, []);
});

test("validateApprovalMatrixRules rejects requiredApprovals exceeding the parallel group size", () => {
  const errors = validateApprovalMatrixRules([
    rule({
      steps: [
        step({ sequence: 1, parallelGroup: 1, requiredApprovals: 5, requiredRole: "A" }),
        step({ sequence: 1, parallelGroup: 1, requiredApprovals: 5, requiredRole: "B" }),
      ],
    }),
  ]);
  assert.ok(errors.some((e) => e.includes("requiredApprovals exceeds")));
});

test("validateApprovalMatrixRules rejects more than one active fallback rule", () => {
  const errors = validateApprovalMatrixRules([rule({ code: "F1", isFallback: true }), rule({ code: "F2", isFallback: true })]);
  assert.ok(errors.some((e) => e.includes("Only one active fallback rule")));
});

test("validateApprovalMatrixRules flags same-priority overlapping rules as conflicting or duplicate", () => {
  const a = rule({ code: "A", priority: 5, conditions: { departmentIds: [facts.departmentId] } });
  const b = rule({ code: "B", priority: 5, conditions: { departmentIds: [facts.departmentId] } });
  const identical = rule({ code: "C", priority: 5, conditions: { departmentIds: [facts.departmentId] } });
  assert.ok(validateApprovalMatrixRules([a, b]).some((e) => e.includes("Duplicate approval matrix rules")));
  const differentSteps = rule({ code: "D", priority: 5, conditions: { departmentIds: [facts.departmentId] }, conditionLogic: "ANY" });
  assert.ok(validateApprovalMatrixRules([a, differentSteps]).some((e) => e.includes("Conflicting priority")));
  assert.ok(validateApprovalMatrixRules([a, b, identical]).length > 0);
});

test("validateApprovalMatrixRules does not flag disjoint amount ranges even at the same priority", () => {
  const low = rule({ code: "LOWRANGE", priority: 5, conditions: { amountMinorMin: "0", amountMinorMax: "1000" } });
  const high = rule({ code: "HIGHRANGE", priority: 5, conditions: { amountMinorMin: "1001" } });
  assert.deepEqual(validateApprovalMatrixRules([low, high]), []);
});
