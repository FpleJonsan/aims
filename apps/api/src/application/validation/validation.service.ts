/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import {
  DOCUMENT_AGENT_PROMPT_VERSION,
  type DocumentValidationOutput,
} from "../../domain/validation.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { AiProvider } from "../../infrastructure/ai/ai-provider.js";
import type { DocumentStorage } from "../../infrastructure/storage/document-storage.js";
import { DOCUMENT_STORAGE } from "../documents/tokens.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import type {
  ClarificationResponseDto,
  ManualValidationDto,
} from "./validation.dto.js";
export const AI_PROVIDER = Symbol("AI_PROVIDER");

@Injectable()
export class ValidationService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider | null,
  ) {}
  private validator(actor: Principal) {
    if (!actor.roles.some((r) => r === "FINANCE" || r === "ADMIN"))
      throw new ForbiddenException("Validator permission required");
  }
  async start(id: string, actor: Principal, correlationId: string) {
    this.validator(actor);
    const run = await this.db.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, id);
      if (request.status !== "SUBMITTED")
        throw new ConflictException(
          "Only SUBMITTED requests can enter Validation",
        );
      const duplicate = await client.query(
        "SELECT 1 FROM validation_runs WHERE payment_request_id=$1 AND is_current",
        [id],
      );
      if (duplicate.rowCount)
        throw new ConflictException("A current validation already exists");
      const flags = await client.query<{ feature: string; enabled: boolean }>(
        "SELECT feature,enabled FROM ai_feature_configuration",
      );
      const enabled = Object.fromEntries(
        flags.rows.map((x) => [x.feature, x.enabled]),
      );
      const aiRequested =
        enabled.AI_MASTER &&
        enabled.DOCUMENT_EXTRACTION &&
        enabled.DOCUMENT_VALIDATION;
      const ai = aiRequested && this.provider;
      const runId = randomUUID();
      await client.query(
        "UPDATE payment_requests SET status='VALIDATING',updated_at=now(),row_version=row_version+1 WHERE id=$1",
        [id],
      );
      await client.query(
        `INSERT INTO validation_runs(id,payment_request_id,request_revision,source,status,created_by,is_current) VALUES($1,$2,$3,$4,$5,$6,true)`,
        [
          runId,
          id,
          request.rowVersion + 1,
          ai ? "AI_ASSISTED" : aiRequested ? "AI_UNAVAILABLE_FALLBACK" : "MANUAL",
          ai ? "PROCESSING" : "PENDING",
          actor.id,
        ],
      );
      if (aiRequested && !this.provider) {
        await client.query("UPDATE validation_runs SET failure_code='PROVIDER_NOT_CONFIGURED',schema_valid=false WHERE id=$1", [runId]);
        await this.requests.audit(client, null, "AI_VALIDATION_FAILED", id, "VALIDATING", "VALIDATING", correlationId, { runId, failureCode: "PROVIDER_NOT_CONFIGURED" });
      }
      await this.requests.audit(
        client,
        actor.id,
        "VALIDATION_STARTED",
        id,
        "SUBMITTED",
        "VALIDATING",
        correlationId,
        { runId, mode: ai ? "AI_ASSISTED" : aiRequested ? "AI_UNAVAILABLE_FALLBACK" : "MANUAL" },
      );
      return { runId, ai: Boolean(ai) };
    });
    if (run.ai) await this.runAi(id, run.runId, correlationId);
    return this.get(id, actor);
  }
  private async runAi(requestId: string, runId: string, correlationId: string) {
    const request = await this.db.pool.query<any>(
      "SELECT * FROM payment_requests WHERE id=$1",
      [requestId],
    );
    const docs = await this.db.pool.query<any>(
      "SELECT id,version,original_filename,mime_type,storage_object_key,sha256 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL",
      [requestId],
    );
    try {
      const inputs = [];
      for (const d of docs.rows)
        inputs.push({
          id: d.id,
          version: d.version,
          filename: d.original_filename,
          mimeType: d.mime_type,
          data: await this.storage.readQuarantined(
            d.storage_object_key,
            d.sha256,
          ),
        });
      const result = await this.provider!.analyzeDocuments({
        request: {
          payee: request.rows[0].payee,
          amount: String(request.rows[0].amount),
          currency: request.rows[0].currency,
          dueDate: String(request.rows[0].due_date),
        },
        documents: inputs,
      });
      await this.db.transaction(async (client) => {
        const locked = await client.query<any>(
          "SELECT vr.*,pr.row_version FROM validation_runs vr JOIN payment_requests pr ON pr.id=vr.payment_request_id WHERE vr.id=$1 FOR UPDATE",
          [runId],
        );
        if (
          !locked.rowCount ||
          !locked.rows[0].is_current ||
          locked.rows[0].request_revision !== locked.rows[0].row_version
        )
          throw new ConflictException("Stale AI validation result rejected");
        await this.persistOutput(client, runId, result.output);
        await client.query(
          "UPDATE validation_runs SET status='AWAITING_HUMAN_REVIEW',confidence=$2,provider=$3,model=$4,prompt_version=$5,schema_valid=true WHERE id=$1",
          [
            runId,
            result.output.confidence,
            result.provider,
            result.model,
            DOCUMENT_AGENT_PROMPT_VERSION,
          ],
        );
        await client.query(
          `INSERT INTO ai_usage_events(id,payment_request_id,validation_run_id,agent,provider,model,prompt_version,input_tokens,output_tokens,total_tokens,latency_ms,status,schema_valid) VALUES($1,$2,$3,'DOCUMENT_AGENT',$4,$5,$6,$7,$8,$9,$10,'COMPLETED',true)`,
          [
            randomUUID(),
            requestId,
            runId,
            result.provider,
            result.model,
            DOCUMENT_AGENT_PROMPT_VERSION,
            result.inputTokens,
            result.outputTokens,
            result.totalTokens,
            result.latencyMs,
          ],
        );
        await this.requests.audit(
          client,
          null,
          "AI_VALIDATION_COMPLETED",
          requestId,
          "VALIDATING",
          "VALIDATING",
          correlationId,
          {
            runId,
            provider: result.provider,
            model: result.model,
            promptVersion: DOCUMENT_AGENT_PROMPT_VERSION,
          },
        );
      });
    } catch (error) {
      await this.db.transaction(async (client) => {
        await client.query(
          "UPDATE validation_runs SET source='AI_UNAVAILABLE_FALLBACK',status='PENDING',failure_code=$2,schema_valid=false WHERE id=$1 AND is_current",
          [runId, error instanceof Error ? error.name : "AI_ERROR"],
        );
        await client.query(
          `INSERT INTO ai_usage_events(id,payment_request_id,validation_run_id,agent,provider,model,prompt_version,status,schema_valid) VALUES($1,$2,$3,'DOCUMENT_AGENT','configured','configured',$4,'FAILED',false)`,
          [randomUUID(), requestId, runId, DOCUMENT_AGENT_PROMPT_VERSION],
        );
        await this.requests.audit(
          client,
          null,
          "AI_VALIDATION_FAILED",
          requestId,
          "VALIDATING",
          "VALIDATING",
          correlationId,
          {
            runId,
            failureCode: error instanceof Error ? error.name : "AI_ERROR",
          },
        );
      });
    }
  }
  async finalize(
    id: string,
    input: ManualValidationDto,
    actor: Principal,
    correlationId: string,
  ) {
    this.validator(actor);
    return this.db.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, id);
      if (request.status !== "VALIDATING")
        throw new ConflictException("Request is not being validated");
      const run = await client.query<any>(
        "SELECT * FROM validation_runs WHERE payment_request_id=$1 AND is_current FOR UPDATE",
        [id],
      );
      if (!run.rowCount)
        throw new NotFoundException("Current validation not found");
      const activeDocuments = await client.query("SELECT 1 FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL LIMIT 1", [id]);
      if (input.overallResult === "PASS" && !activeDocuments.rowCount)
        throw new BadRequestException("Validation cannot PASS without a supporting document");
      if (input.overallResult === "PASS" && input.findings.some(finding => finding.status === "FAIL" || finding.status === "UNKNOWN"))
        throw new BadRequestException("Validation cannot PASS with failed or unknown findings");
      // AI candidates remain immutable evidence; human review findings append to the run.
      for (const finding of input.findings) {
        const findingId = randomUUID();
        await client.query(
          `INSERT INTO validation_findings(id,validation_run_id,code,check_status,severity,explanation,request_value,document_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            findingId,
            run.rows[0].id,
            finding.code,
            finding.status,
            finding.severity,
            finding.explanation,
            finding.requestValue ?? null,
            finding.documentValue ?? null,
          ],
        );
        await client.query(
          `INSERT INTO validation_evidence(id,finding_id,document_id,document_version,field_name,safe_reference) VALUES($1,$2,$3,$4,'manual','Manual validator evidence')`,
          [
            randomUUID(),
            findingId,
            finding.documentId ?? null,
            finding.documentVersion ?? null,
          ],
        );
      }
      await client.query(
        "UPDATE validation_runs SET status='COMPLETED',overall_result=$2,remarks=$3,reviewed_by=$4,completed_at=now() WHERE id=$1",
        [run.rows[0].id, input.overallResult, input.remarks, actor.id],
      );
      if (input.overallResult === "CLARIFICATION_REQUIRED") {
        const clarificationId = randomUUID();
        await client.query(
          "UPDATE payment_requests SET status='NEEDS_CLARIFICATION',updated_at=now(),row_version=row_version+1 WHERE id=$1",
          [id],
        );
        await client.query(
          `INSERT INTO validation_clarifications(id,payment_request_id,validation_run_id,clarification_type,reason,required_response,requested_by) VALUES($1,$2,$3,'VALIDATION',$4,$5,$6)`,
          [
            clarificationId,
            id,
            run.rows[0].id,
            input.remarks,
            input.requiredResponse ?? null,
            actor.id,
          ],
        );
        await this.requests.audit(
          client,
          actor.id,
          "VALIDATION_CLARIFICATION_REQUESTED",
          id,
          "VALIDATING",
          "NEEDS_CLARIFICATION",
          correlationId,
          { runId: run.rows[0].id, clarificationId },
        );
      } else
        await this.requests.audit(
          client,
          actor.id,
          run.rows[0].source === "MANUAL"
            ? "MANUAL_VALIDATION_COMPLETED"
            : "AI_VALIDATION_COMPLETED",
          id,
          "VALIDATING",
          "VALIDATING",
          correlationId,
          {
            runId: run.rows[0].id,
            result: "PASS",
            readyForFinanceContext: true,
          },
        );
      return {
        result: input.overallResult,
        readyForFinanceContext: input.overallResult === "PASS",
      };
    });
  }
  async respond(
    id: string,
    clarificationId: string,
    input: ClarificationResponseDto,
    actor: Principal,
    correlationId: string,
  ) {
    return this.db.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, id);
      if (
        request.status !== "NEEDS_CLARIFICATION" ||
        request.createdBy !== actor.id
      )
        throw new ForbiddenException("Clarification response is not permitted");
      const clarification = await client.query<any>(
        "SELECT * FROM validation_clarifications WHERE id=$1 AND payment_request_id=$2 AND status='OPEN' FOR UPDATE",
        [clarificationId, id],
      );
      if (!clarification.rowCount)
        throw new NotFoundException("Open clarification not found");
      const snapshot = JSON.stringify(request);
      await client.query(
        `INSERT INTO payment_request_revisions(id,payment_request_id,revision,snapshot,reason,created_by) VALUES($1,$2,$3,$4,'VALIDATION_CLARIFICATION',$5)`,
        [randomUUID(), id, request.rowVersion, snapshot, actor.id],
      );
      await client.query(
        `UPDATE payment_requests SET payee=COALESCE($2,payee),purpose=COALESCE($3,purpose),amount=COALESCE($4,amount),currency=COALESCE($5,currency),due_date=COALESCE($6,due_date),payment_details=COALESCE($7,payment_details),status='SUBMITTED',updated_at=now(),row_version=row_version+1 WHERE id=$1`,
        [
          id,
          input.payee ?? null,
          input.purpose ?? null,
          input.amount ?? null,
          input.currency ?? null,
          input.dueDate ?? null,
          input.paymentDetails ?? null,
        ],
      );
      await client.query(
        "UPDATE validation_clarifications SET response=$2,responded_by=$3,responded_at=now(),status='RESPONDED' WHERE id=$1",
        [clarificationId, input.response, actor.id],
      );
      await client.query(
        "UPDATE validation_runs SET is_current=false,status='SUPERSEDED' WHERE payment_request_id=$1 AND is_current",
        [id],
      );
      await this.requests.audit(
        client,
        actor.id,
        "VALIDATION_CLARIFICATION_RESPONDED",
        id,
        "NEEDS_CLARIFICATION",
        "SUBMITTED",
        correlationId,
        { clarificationId },
      );
      await this.requests.audit(
        client,
        actor.id,
        "VALIDATION_SUPERSEDED",
        id,
        "SUBMITTED",
        "SUBMITTED",
        correlationId,
        { validationRunId: clarification.rows[0].validation_run_id },
      );
      return { status: "SUBMITTED", requiresRevalidation: true };
    });
  }
  async get(id: string, actor: Principal) {
    await this.requests.get(id, actor);
    const [current, history, clarifications] = await Promise.all([
      this.db.pool.query(
        "SELECT * FROM validation_runs WHERE payment_request_id=$1 AND is_current",
        [id],
      ),
      this.db.pool.query(
        "SELECT * FROM validation_runs WHERE payment_request_id=$1 ORDER BY created_at DESC",
        [id],
      ),
      this.db.pool.query(
        "SELECT * FROM validation_clarifications WHERE payment_request_id=$1 ORDER BY requested_at DESC",
        [id],
      ),
    ]);
    const run = current.rows[0];
    let findings: any[] = [];
    let extractions: any[] = [];
    if (run) {
      findings = (
        await this.db.pool.query(
          "SELECT vf.*,COALESCE(json_agg(ve.*) FILTER (WHERE ve.id IS NOT NULL),'[]') evidence FROM validation_findings vf LEFT JOIN validation_evidence ve ON ve.finding_id=vf.id WHERE vf.validation_run_id=$1 GROUP BY vf.id",
          [run.id],
        )
      ).rows;
      extractions = (
        await this.db.pool.query(
          "SELECT * FROM document_extractions WHERE validation_run_id=$1",
          [run.id],
        )
      ).rows;
    }
    return {
      current: run ?? null,
      findings,
      extractions,
      clarifications: clarifications.rows,
      history: history.rows,
    };
  }
  private async persistOutput(
    client: any,
    runId: string,
    output: DocumentValidationOutput,
  ) {
    for (const extraction of output.extractions)
      await client.query(
        `INSERT INTO document_extractions(id,validation_run_id,document_id,document_version,extraction,confidence) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          randomUUID(),
          runId,
          extraction.documentId,
          extraction.documentVersion,
          JSON.stringify(extraction),
          extraction.confidence,
        ],
      );
    for (const finding of output.checks) {
      const findingId = randomUUID();
      await client.query(
        `INSERT INTO validation_findings(id,validation_run_id,code,check_status,severity,explanation,request_value,document_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          findingId,
          runId,
          finding.code,
          finding.status,
          finding.severity,
          finding.explanation,
          finding.requestValue,
          finding.documentValue,
        ],
      );
      for (const evidence of finding.evidenceReferences)
        await client.query(
          `INSERT INTO validation_evidence(id,finding_id,document_id,document_version,field_name,safe_reference) VALUES($1,$2,$3,$4,$5,$6)`,
          [
            randomUUID(),
            findingId,
            evidence.documentId,
            evidence.documentVersion,
            evidence.field,
            evidence.reference,
          ],
        );
    }
  }
}
