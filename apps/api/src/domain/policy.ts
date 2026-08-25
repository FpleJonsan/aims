import { z } from "zod";

export const ApprovalStepSchema = z
  .object({
    sequence: z.number().int().positive(),
    requiredRole: z.string().min(1).max(64),
    authorityScope: z.enum(["DEPARTMENT", "ORGANIZATION"]),
    minimumAmountMinor: z.string().regex(/^\d+$/).optional(),
    maximumAmountMinor: z.string().regex(/^\d+$/).optional(),
    departmentScope: z.string().uuid().optional(),
    mandatory: z.boolean(),
    reason: z.string().min(1).max(500),
  })
  .strict();

export const PolicyConditionsSchema = z
  .object({
    amountMinorMin: z.string().regex(/^\d+$/).optional(),
    amountMinorMax: z.string().regex(/^\d+$/).optional(),
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).optional(),
    departmentIds: z.array(z.string().uuid()).optional(),
    categories: z.array(z.string().min(1).max(100)).optional(),
    riskLevels: z
      .array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]))
      .optional(),
    priorities: z.array(z.enum(["LOW", "NORMAL", "HIGH", "URGENT"])).optional(),
    paymentMethods: z.array(z.string().min(1).max(64)).optional(),
    riskFlagsAny: z.array(z.string().min(1).max(64)).optional(),
  })
  .strict();

export const PolicyRuleSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    priority: z.number().int(),
    effect: z.enum([
      "REQUIRE_APPROVAL",
      "ALLOW_NO_APPROVAL",
      "REQUIRE_JUSTIFICATION",
    ]),
    conditions: PolicyConditionsSchema,
    approvalSteps: z.array(ApprovalStepSchema),
    requiredEvidence: z.array(z.string().min(1).max(64)),
    escalation: z.string().nullable(),
    notificationMetadata: z.record(z.string(), z.string()),
    autoApprovalEligible: z.boolean(),
    exceptionCode: z.string().nullable(),
    exceptionReason: z.string().nullable(),
    justificationRole: z.enum(["REQUESTER", "FINANCE", "ADMIN"]).nullable(),
  })
  .strict();

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export interface PolicyFacts {
  amountMinor: bigint;
  currency: string;
  departmentId: string;
  category: string;
  paymentMethod: string;
  riskLevel: string;
  priority: string;
  riskFlags: string[];
  evidenceTypes: string[];
}

export function matches(rule: PolicyRule, facts: PolicyFacts): boolean {
  const c = rule.conditions;
  return (
    !(c.amountMinorMin && facts.amountMinor < BigInt(c.amountMinorMin)) &&
    !(c.amountMinorMax && facts.amountMinor > BigInt(c.amountMinorMax)) &&
    (!c.currencies || c.currencies.includes(facts.currency)) &&
    (!c.departmentIds || c.departmentIds.includes(facts.departmentId)) &&
    (!c.categories || c.categories.includes(facts.category)) &&
    (!c.riskLevels || c.riskLevels.includes(facts.riskLevel as never)) &&
    (!c.priorities || c.priorities.includes(facts.priority as never)) &&
    (!c.paymentMethods || c.paymentMethods.includes(facts.paymentMethod)) &&
    (!c.riskFlagsAny || c.riskFlagsAny.some((f) => facts.riskFlags.includes(f)))
  );
}

export function evaluatePolicy(rules: PolicyRule[], facts: PolicyFacts) {
  const matched = rules
    .filter((r) => matches(r, facts))
    .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
  const exception = matched.find((r) => r.effect === "REQUIRE_JUSTIFICATION");
  const requiredEvidence = [
    ...new Set(matched.flatMap((r) => r.requiredEvidence)),
  ].sort();
  const missingEvidence = requiredEvidence.filter(
    (e) => !facts.evidenceTypes.includes(e),
  );
  if (exception || missingEvidence.length)
    return {
      result: "JUSTIFICATION_REQUIRED" as const,
      matched,
      approvalPlan: [],
      requiredEvidence,
      missingEvidence,
      approvalRequired: false,
      autoApprovalEligible: false,
      exception: exception ?? null,
    };
  const approval = matched.filter((r) => r.effect === "REQUIRE_APPROVAL");
  const plan = [
    ...new Map(
      approval
        .flatMap((r) => r.approvalSteps)
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => [`${s.sequence}:${s.requiredRole}:${s.authorityScope}`, s]),
    ).values(),
  ];
  const allowNoApproval = matched.some((r) => r.effect === "ALLOW_NO_APPROVAL");
  return {
    result: "PASS" as const,
    matched,
    approvalPlan: plan,
    requiredEvidence,
    missingEvidence,
    approvalRequired: plan.length > 0,
    autoApprovalEligible:
      allowNoApproval &&
      matched.every((r) => r.autoApprovalEligible) &&
      plan.length === 0,
    exception: null,
  };
}

export function validateNoAmbiguity(rules: PolicyRule[]): void {
  for (const rule of rules) {
    const c = rule.conditions;
    if (
      c.amountMinorMin &&
      c.amountMinorMax &&
      BigInt(c.amountMinorMin) > BigInt(c.amountMinorMax)
    )
      throw new Error(`Invalid amount range: ${rule.code}`);
    const sequences = rule.approvalSteps.map((step) => step.sequence);
    if (new Set(sequences).size !== sequences.length)
      throw new Error(`Duplicate approval sequence: ${rule.code}`);
    if (rule.effect === "REQUIRE_APPROVAL" && !rule.approvalSteps.length)
      throw new Error(`Approval rule requires steps: ${rule.code}`);
    if (rule.effect !== "REQUIRE_APPROVAL" && rule.approvalSteps.length)
      throw new Error(
        `Non-approval rule cannot define approval steps: ${rule.code}`,
      );
    if (rule.autoApprovalEligible && rule.effect !== "ALLOW_NO_APPROVAL")
      throw new Error(
        `Auto-approval eligibility requires ALLOW_NO_APPROVAL: ${rule.code}`,
      );
  }
  const enabled = rules;
  for (let i = 0; i < enabled.length; i++)
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i],
        b = enabled[j];
      const ac = a.conditions,
        bc = b.conditions;
      const amountOverlap =
        !(
          ac.amountMinorMax &&
          bc.amountMinorMin &&
          BigInt(ac.amountMinorMax) < BigInt(bc.amountMinorMin)
        ) &&
        !(
          bc.amountMinorMax &&
          ac.amountMinorMin &&
          BigInt(bc.amountMinorMax) < BigInt(ac.amountMinorMin)
        );
      const listOverlap = (x?: string[], y?: string[]) =>
        !x || !y || x.some((v) => y.includes(v));
      const overlap =
        amountOverlap &&
        listOverlap(ac.currencies, bc.currencies) &&
        listOverlap(ac.departmentIds, bc.departmentIds) &&
        listOverlap(ac.categories, bc.categories) &&
        listOverlap(ac.riskLevels, bc.riskLevels) &&
        listOverlap(ac.priorities, bc.priorities) &&
        listOverlap(ac.paymentMethods, bc.paymentMethods) &&
        listOverlap(ac.riskFlagsAny, bc.riskFlagsAny);
      if (!overlap) continue;
      const exactConditions = JSON.stringify(ac) === JSON.stringify(bc);
      if (a.priority === b.priority && a.effect !== b.effect)
        throw new Error(`Ambiguous policy rules: ${a.code}, ${b.code}`);
      if (a.priority === b.priority && a.effect === b.effect && exactConditions)
        throw new Error(`Duplicate policy rules: ${a.code}, ${b.code}`);
      if (a.effect === "REQUIRE_APPROVAL" && b.effect === "REQUIRE_APPROVAL") {
        for (const x of a.approvalSteps)
          for (const y of b.approvalSteps)
            if (
              x.sequence === y.sequence &&
              (x.requiredRole !== y.requiredRole ||
                x.authorityScope !== y.authorityScope)
            )
              throw new Error(
                `Ambiguous approval sequence: ${a.code}, ${b.code}`,
              );
      }
    }
}
