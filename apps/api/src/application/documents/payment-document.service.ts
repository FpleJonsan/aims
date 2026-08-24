import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { canEditDraft, type Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { DocumentStorage } from "../../infrastructure/storage/document-storage.js";
import { DOCUMENT_STORAGE } from "./tokens.js";
import { Inject } from "@nestjs/common";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";

@Injectable()
export class PaymentDocumentService {
  constructor(
    private readonly database: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  async upload(
    requestId: string,
    file: Express.Multer.File,
    documentType: string | undefined,
    actor: Principal,
    correlationId: string,
  ): Promise<unknown> {
    const request = await this.requests.get(requestId, actor);
    const clarificationUpload = await this.canUploadClarification(requestId, request.status, request.createdBy, actor);
    if (!canEditDraft(actor, request) && !clarificationUpload)
      throw new ForbiddenException("Documents can only be changed on an authorized DRAFT or open Validation clarification");
    const normalizedDocumentType = documentType?.trim() || null;
    if (normalizedDocumentType && normalizedDocumentType.length > 64) {
      throw new BadRequestException(
        "Document type must not exceed 64 characters",
      );
    }
    const documentId = randomUUID();
    const logicalDocumentId = randomUUID();
    const safeName = sanitizeFilename(file.originalname);
    const stored = await this.storage.storeQuarantined({
      key: `payment-requests/${requestId}/documents/${documentId}`,
      declaredContentType: file.mimetype,
      data: oneChunk(file.buffer),
    });
    try {
      return await this.database.transaction(async (client) => {
        const locked = await this.requests.lockRequest(client, requestId);
        const clarificationStillOpen = locked.status === "NEEDS_CLARIFICATION" && locked.createdBy === actor.id && Boolean((await client.query("SELECT 1 FROM validation_clarifications WHERE payment_request_id=$1 AND status='OPEN'", [requestId])).rowCount);
        if (!canEditDraft(actor, locked) && !clarificationStillOpen)
          throw new ConflictException(
            "Request changed while the document was uploading",
          );
        const prior = clarificationStillOpen ? await client.query<{logical_document_id:string;version:number}>("SELECT logical_document_id,version FROM payment_documents WHERE payment_request_id=$1 AND original_filename=$2 AND removed_at IS NULL ORDER BY version DESC LIMIT 1 FOR UPDATE", [requestId, safeName]) : null;
        const logicalId = prior?.rows[0]?.logical_document_id ?? logicalDocumentId;
        const version = (prior?.rows[0]?.version ?? 0) + 1;
        if (prior?.rowCount) await client.query("UPDATE payment_documents SET removed_at=now() WHERE payment_request_id=$1 AND logical_document_id=$2 AND removed_at IS NULL", [requestId, logicalId]);
        const result = await client.query(
          `INSERT INTO payment_documents
          (id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING id, original_filename, mime_type, size_bytes, sha256, document_type, version, uploaded_by, uploaded_at`,
          [
            documentId,
            requestId,
            logicalId,
            safeName,
            stored.key,
            stored.contentType,
            stored.sizeBytes,
            stored.sha256,
            normalizedDocumentType,
            version,
            actor.id,
          ],
        );
        await this.requests.audit(
          client,
          actor.id,
          clarificationStillOpen ? "DOCUMENT_REPLACED" : "DOCUMENT_UPLOADED",
          requestId,
          locked.status,
          locked.status,
          correlationId,
          { documentId, sha256: stored.sha256, version },
        );
        return result.rows[0];
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505") {
        throw new ConflictException("The same document is already attached");
      }
      throw error;
    }
  }

  private async canUploadClarification(requestId:string,status:string,createdBy:string,actor:Principal):Promise<boolean>{
    if(status!=="NEEDS_CLARIFICATION"||createdBy!==actor.id)return false;
    return Boolean((await this.database.pool.query("SELECT 1 FROM validation_clarifications WHERE payment_request_id=$1 AND status='OPEN'",[requestId])).rowCount);
  }

  async remove(
    requestId: string,
    documentId: string,
    actor: Principal,
    correlationId: string,
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request))
        throw new ForbiddenException(
          "Documents can only be changed on an authorized DRAFT",
        );
      const result = await client.query(
        "UPDATE payment_documents SET removed_at=now() WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NULL RETURNING id",
        [documentId, requestId],
      );
      if (!result.rowCount) throw new NotFoundException("Document not found");
      await this.requests.audit(
        client,
        actor.id,
        "DOCUMENT_REMOVED",
        requestId,
        "DRAFT",
        "DRAFT",
        correlationId,
        { documentId },
      );
    });
  }
}

function sanitizeFilename(filename: string): string {
  const leaf = filename.replace(/\\/g, "/").split("/").at(-1) ?? "document";
  const safe = leaf
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (safe || "document").slice(0, 255);
}

async function* oneChunk(data: Buffer): AsyncIterable<Uint8Array> {
  yield data;
}
