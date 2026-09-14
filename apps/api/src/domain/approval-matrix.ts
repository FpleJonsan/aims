import { z } from "zod";

const StringMatchSchema = z
  .object({
    op: z.enum(["EQUALS", "CONTAINS", "STARTS_WITH", "ENDS_WITH"]),
    values: z.array(z.string().min(1).max(200)).min(1),
  })
  .strict();
export type StringMatch = z.infer<typeof StringMatchSchema>;

export const ApprovalMatrixConditionsSchema = z
  .object({
    departmentIds: z.array(z.string().uuid()).optional(),
    projectIds: z.array(z.string().uuid()).optional(),
    categories: StringMatchSchema.optional(),
    paymentTypes: StringMatchSchema.optional(),
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).optional(),
    amountMinorMin: z.string().regex(/^\d+$/).optional(),
    amountMinorMax: z.string().regex(/^\d+$/).optional(),
    riskLevels: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])).optional(),
    priorities: z.array(z.enum(["LOW", "NORMAL", "HIGH", "URGENT"])).optional(),
    claimCountMin: z.number().int().positive().optional(),
    claimCountMax: z.number().int().positive().optional(),
  })
  .strict();
export type ApprovalMatrixConditions = z.infer<typeof ApprovalMatrixConditionsSchema>;

export const ApprovalMatrixStepSchema = z
  .object({
    sequence: z.number().int().positive(),
    parallelGroup: z.number().int().positive().nullable().default(null),
    requiredApprovals: z.number().int().positive().nullable().default(null),
    requiredRole: z.string().min(1).max(64),
    authorityScope: z.enum(["DEPARTMENT", "ORGANIZATION"]),
    departmentScope: z.string().uuid().optional(),
    minimumAmountMinor: z.string().regex(/^\d+$/).optional(),
    maximumAmountMinor: z.string().regex(/^\d+$/).optional(),
    mandatory: z.boolean().default(true),
    reason: z.string().min(1).max(500),
  })
  .strict();
export type ApprovalMatrixStep = z.infer<typeof ApprovalMatrixStepSchema>;

export const ApprovalMatrixRuleSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    priority: z.number().int(),
    active: z.boolean().default(true),
    isFallback: z.boolean().default(false),
    conditionLogic: z.enum(["ALL", "ANY"]).default("ALL"),
    conditions: ApprovalMatrixConditionsSchema,
    financeReviewRequired: z.boolean().default(false),
    aiAnalysisRequired: z.boolean().default(false),
    steps: z.array(ApprovalMatrixStepSchema).min(1),
    effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    effectiveTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type ApprovalMatrixRule = z.infer<typeof ApprovalMatrixRuleSchema>;

export const ApprovalMatrixPayloadSchema = z
  .object({
    routingEnabled: z.boolean().default(true),
    rules: z.array(ApprovalMatrixRuleSchema),
  })
  .strict();
export type ApprovalMatrixPayload = z.infer<typeof ApprovalMatrixPayloadSchema>;

export interface ApprovalMatrixFacts {
  amountMinor: bigint;
  currency: string;
  departmentId: string;
  category: string;
  projectIds: string[];
  paymentMethod: string;
  riskLevel: string;
  priority: string;
  claimCount: number;
  asOfDate: string;
}

function testStringMatch(match: StringMatch | undefined, value: string): boolean {
  if (!match) return true;
  const hay = value.toUpperCase();
  return match.values.some((candidate) => {
    const needle = candidate.toUpperCase();
    switch (match.op) {
      case "EQUALS":
        return hay === needle;
      case "CONTAINS":
        return hay.includes(needle);
      case "STARTS_WITH":
        return hay.startsWith(needle);
      case "ENDS_WITH":
        return hay.endsWith(needle);
    }
  });
}

function withinEffectiveWindow(rule: ApprovalMatrixRule, asOfDate: string): boolean {
  return rule.effectiveFrom <= asOfDate && (!rule.effectiveTo || asOfDate <= rule.effectiveTo);
}

function evaluateClauses(rule: ApprovalMatrixRule, facts: ApprovalMatrixFacts): boolean {
  const c = rule.conditions;
  const clauses: (boolean | undefined)[] = [
    c.departmentIds && c.departmentIds.includes(facts.departmentId),
    c.projectIds && c.projectIds.some((id) => facts.projectIds.includes(id)),
    c.categories && testStringMatch(c.categories, facts.category),
    c.paymentTypes && testStringMatch(c.paymentTypes, facts.paymentMethod),
    c.currencies && c.currencies.includes(facts.currency),
    c.riskLevels && c.riskLevels.includes(facts.riskLevel as never),
    c.priorities && c.priorities.includes(facts.priority as never),
    c.amountMinorMin === undefined && c.amountMinorMax === undefined
      ? undefined
      : !(c.amountMinorMin && facts.amountMinor < BigInt(c.amountMinorMin)) &&
        !(c.amountMinorMax && facts.amountMinor > BigInt(c.amountMinorMax)),
    c.claimCountMin === undefined && c.claimCountMax === undefined
      ? undefined
      : !(c.claimCountMin !== undefined && facts.claimCount < c.claimCountMin) &&
        !(c.claimCountMax !== undefined && facts.claimCount > c.claimCountMax),
  ];
  const present = clauses.filter((clause) => clause !== undefined) as boolean[];
  if (!present.length) return true;
  return rule.conditionLogic === "ANY" ? present.some(Boolean) : present.every(Boolean);
}

export function matchesRule(rule: ApprovalMatrixRule, facts: ApprovalMatrixFacts): boolean {
  if (!rule.active || !withinEffectiveWindow(rule, facts.asOfDate)) return false;
  if (rule.isFallback) return true;
  return evaluateClauses(rule, facts);
}

export interface ApprovalMatrixResolution {
  rule: ApprovalMatrixRule;
  steps: ApprovalMatrixStep[];
}

/**
 * Unlike Policy (which unions approval steps across every matched rule),
 * the Matrix produces one whole routing plan, so exactly one winning rule
 * is selected: the highest-priority (lowest number) matching non-fallback
 * rule, falling back to the active fallback rule if nothing else matches.
 * validateApprovalMatrixRules rejects same-priority overlapping rules
 * before publish, so a priority tie among matched rules cannot occur here.
 */
export function resolveApprovalMatrix(
  rules: ApprovalMatrixRule[],
  facts: ApprovalMatrixFacts,
): ApprovalMatrixResolution | null {
  const candidates = rules
    .filter((rule) => !rule.isFallback && matchesRule(rule, facts))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  const winner =
    candidates[0] ?? rules.find((rule) => rule.isFallback && matchesRule(rule, facts));
  return winner ? { rule: winner, steps: [...winner.steps].sort((a, b) => a.sequence - b.sequence) } : null;
}

export function validateApprovalMatrixRules(rules: ApprovalMatrixRule[]): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const rule of rules) {
    if (codes.has(rule.code)) errors.push(`Duplicate rule code: ${rule.code}`);
    codes.add(rule.code);
    if (rule.effectiveTo && rule.effectiveFrom > rule.effectiveTo)
      errors.push(`Invalid effective dates: ${rule.code}`);
    const sequenceGroups = new Map<number, ApprovalMatrixStep[]>();
    for (const step of rule.steps)
      sequenceGroups.set(step.sequence, [...(sequenceGroups.get(step.sequence) ?? []), step]);
    for (const [sequence, steps] of sequenceGroups) {
      const groups = new Set(steps.map((s) => s.parallelGroup));
      if (groups.size > 1)
        errors.push(`Rule ${rule.code} sequence ${sequence}: steps at the same sequence must share one parallel group`);
      if (steps.length > 1 && steps.every((s) => s.parallelGroup === null))
        errors.push(`Rule ${rule.code} sequence ${sequence}: duplicate sequence without a parallel group`);
      const requiredApprovals = steps[0]?.requiredApprovals;
      if (requiredApprovals !== null && requiredApprovals !== undefined && requiredApprovals > steps.length)
        errors.push(`Rule ${rule.code} sequence ${sequence}: requiredApprovals exceeds the number of parallel steps`);
    }
    if (!rule.steps.length) errors.push(`Rule ${rule.code} must define at least one approval step`);
  }
  const active = rules.filter((rule) => rule.active);
  const fallbacks = active.filter((rule) => rule.isFallback);
  if (fallbacks.length > 1)
    errors.push(`Only one active fallback rule is allowed: ${fallbacks.map((r) => r.code).join(", ")}`);

  const nonFallback = active.filter((rule) => !rule.isFallback);
  for (let i = 0; i < nonFallback.length; i++)
    for (let j = i + 1; j < nonFallback.length; j++) {
      const a = nonFallback[i],
        b = nonFallback[j];
      if (a.priority !== b.priority) continue;
      const overlap = conditionsMayOverlap(a.conditions, b.conditions);
      if (!overlap) continue;
      const identical = JSON.stringify(a.conditions) === JSON.stringify(b.conditions) && a.conditionLogic === b.conditionLogic;
      errors.push(
        identical
          ? `Duplicate approval matrix rules: ${a.code}, ${b.code}`
          : `Conflicting priority between overlapping rules: ${a.code}, ${b.code}`,
      );
    }
  return errors;
}

function conditionsMayOverlap(a: ApprovalMatrixConditions, b: ApprovalMatrixConditions): boolean {
  const listOverlap = (x?: string[], y?: string[]) => !x || !y || x.some((v) => y.includes(v));
  const rangeOverlap = (minA?: string, maxA?: string, minB?: string, maxB?: string) =>
    !(maxA && minB && BigInt(maxA) < BigInt(minB)) && !(maxB && minA && BigInt(maxB) < BigInt(minA));
  const countOverlap = (minA?: number, maxA?: number, minB?: number, maxB?: number) =>
    !(maxA !== undefined && minB !== undefined && maxA < minB) &&
    !(maxB !== undefined && minA !== undefined && maxB < minA);
  return (
    listOverlap(a.departmentIds, b.departmentIds) &&
    listOverlap(a.projectIds, b.projectIds) &&
    listOverlap(a.currencies, b.currencies) &&
    listOverlap(a.riskLevels, b.riskLevels) &&
    listOverlap(a.priorities, b.priorities) &&
    rangeOverlap(a.amountMinorMin, a.amountMinorMax, b.amountMinorMin, b.amountMinorMax) &&
    countOverlap(a.claimCountMin, a.claimCountMax, b.claimCountMin, b.claimCountMax) &&
    // StringMatch (categories/paymentTypes) conditions cannot generally be
    // proven disjoint (e.g. CONTAINS "A" vs CONTAINS "B" may both match one
    // value); treat "both set" as a possible overlap conservatively unless
    // one side is unset.
    true
  );
}
