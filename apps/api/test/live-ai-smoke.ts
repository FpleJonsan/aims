import {
  AiProviderError,
  OpenAiCompatibleProvider,
} from "../src/infrastructure/ai/openai-compatible-provider.js";
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.log("SKIPPED: OPENAI_API_KEY is not configured");
  process.exit(0);
}
const provider = new OpenAiCompatibleProvider(
  key,
  process.env.OPENAI_MODEL ?? "gpt-5-mini",
  process.env.OPENAI_BASE_URL,
);
try {
  const diagnostic = await provider.diagnoseStructuredOutput();
  console.log(
    JSON.stringify({
      phase: "structured-output-baseline",
      httpSuccess: true,
      ...diagnostic,
    }),
  );
  const pdf = createSyntheticPdf(
    "Synthetic invoice Vendor TEST MYR 1.00 due 2026-09-01",
  );
  const result = await provider.analyzeDocuments({
    request: {
      payee: "Vendor TEST",
      amount: "1.00",
      currency: "MYR",
      dueDate: "2026-09-01",
    },
    documents: [
      {
        id: "00000000-0000-4000-8000-000000000111",
        version: 1,
        sha256:
          "0000000000000000000000000000000000000000000000000000000000000000",
        filename: "synthetic.pdf",
        mimeType: "application/pdf",
        data: pdf,
      },
    ],
  });
  console.log(
    JSON.stringify({
      phase: "document-agent",
      httpSuccess: true,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
      schemaValid: true,
      domainValid: true,
    }),
  );
} catch (error) {
  if (error instanceof AiProviderError)
    console.error(JSON.stringify({ httpSuccess: false, ...error.details }));
  else
    console.error(
      JSON.stringify({
        httpSuccess: false,
        classification: "UNKNOWN_PROVIDER_ERROR",
        message: "Live AI diagnostic failed unexpectedly.",
      }),
    );
  process.exitCode = 1;
}

function createSyntheticPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 5 0 R>>>> /Contents 4 0 R>>",
    `<</Length ${new TextEncoder().encode(stream).length}>>\nstream\n${stream}\nendstream`,
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
