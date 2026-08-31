import {
  DocumentValidationOutputSchema,
  type DocumentValidationOutput,
} from "../../domain/validation.js";

export interface AiDocument {
  id: string;
  version: number;
  sha256: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
}
export interface DocumentAgentInput {
  request: {
    payee: string | null;
    amount: string | null;
    currency: string | null;
    dueDate: string | null;
  };
  documents: AiDocument[];
}
export interface AiProviderResult {
  output: DocumentValidationOutput;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  retryCount: number;
  providerAttempts: number;
}
export interface AiProvider {
  analyzeDocuments(input: DocumentAgentInput): Promise<AiProviderResult>;
}

export class FakeAiProvider implements AiProvider {
  calls = 0;
  constructor(private readonly candidate: unknown) {}
  async analyzeDocuments(input: DocumentAgentInput): Promise<AiProviderResult> {
    void input;
    this.calls++;
    return {
      output: DocumentValidationOutputSchema.parse(this.candidate),
      provider: "fake",
      model: "deterministic-test",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      retryCount: 0,
      providerAttempts: 1,
    };
  }
}
