/* eslint-disable @typescript-eslint/no-explicit-any */
import { OpenAiCompatibleProvider } from "../src/infrastructure/ai/openai-compatible-provider.js";
import { AskAimsOutputSchema, FinanceWatchOutputSchema, validateEvidence } from "../src/domain/finance-intelligence.js";
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("SKIPPED: OPENAI_API_KEY is not configured");
  process.exit(0);
}
const provider = new OpenAiCompatibleProvider(
    key,
    process.env.OPENAI_MODEL ?? "gpt-5-mini",
    process.env.OPENAI_BASE_URL,
  ),
  catalog = [
    {
      metric: "financial.utilisationBasisPoints",
      reference: "synthetic-company",
      value: 8200,
    },
  ];
const watch = await provider.analyzeFinanceIntelligence("FINANCE_WATCH", {
  synthetic: true,
  period: "2026-08",
  financial: { utilisationBasisPoints: 8200 },
  evidenceCatalog: catalog,
});
const ask = await provider.analyzeFinanceIntelligence("ASK_AIMS", {
  synthetic: true,
  question: "Which area has budget pressure?",
  toolResults: {
    budget: [
      { department: "Synthetic Operations", utilisationBasisPoints: 8200 },
    ],
  },
  evidenceCatalog: catalog,
});
const allowed = new Map(catalog.map((x)=>[`${x.metric}:${x.reference}`,String(x.value)]));
const watchOutput = FinanceWatchOutputSchema.parse(watch.output);
for (const insight of watchOutput.insights) validateEvidence(insight, allowed);
const askOutput = AskAimsOutputSchema.parse(ask.output);
validateEvidence(askOutput, allowed);
console.log(
  JSON.stringify({
    provider: watch.provider,
    model: watch.model,
    watch: {
      tokens: watch.totalTokens,
      latencyMs: watch.latencyMs,
      schemaValid: true,
      evidenceValid: true,
      evidenceCount:
        (watch.output as any).insights?.flatMap((x: any) => x.evidence)
          .length ?? 0,
    },
    ask: {
      tokens: ask.totalTokens,
      latencyMs: ask.latencyMs,
      schemaValid: true,
      evidenceValid: true,
      evidenceCount: (ask.output as any).evidenceReferences?.length ?? 0,
    },
    costEstimate: "COST NOT CONFIGURED",
  }),
);
