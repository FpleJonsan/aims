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

type DownloadDocumentRow = {storage_object_key:string;sha256:string;mime_type:string;original_filename:string};

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
    assertAllowedDocumentExtension(safeName,file.mimetype);
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
          (id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status,storage_binding_state,storage_backend_id,storage_object_version)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$15,$12,$6,'QUARANTINED','VERSION_BOUND',$13,$14)
          RETURNING id, original_filename, mime_type, size_bytes, sha256, document_type, version, uploaded_by, uploaded_at,security_status`,
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
            file.mimetype.trim().toLowerCase(),
            stored.backendId,
            stored.objectVersion,
            stored.provider,
          ],
        );
        await this.requests.audit(
          client,
          actor.id,
          clarificationStillOpen ? "DOCUMENT_REPLACED_QUARANTINED" : "DOCUMENT_QUARANTINED",
          requestId,
          locked.status,
          locked.status,
          correlationId,
          { documentId, sha256: stored.sha256, version },
        );
        return result.rows[0];
      });
    } catch (error) {
      await this.storage.delete(stored.backendId,stored.key,stored.objectVersion).catch(()=>undefined);
      if (error instanceof Error && "code" in error && error.code === "23505") {
        throw new ConflictException("The same document is already attached");
      }
      throw error;
    }
  }

  async scan(requestId:string,documentId:string,actor:Principal,correlationId:string):Promise<{id:string;securityStatus:string}>{
    void requestId;void documentId;void actor;void correlationId;
    throw new ConflictException("Document scanning is performed by the durable document worker");
  }

  async download(requestId:string,documentId:string,actor:Principal,correlationId:string){
    const request=await this.requests.get(requestId,actor);
    const q=await this.database.pool.query<DownloadDocumentRow & {storage_backend_id:string;trusted_storage_object_key:string;trusted_storage_object_version:string}>(`SELECT storage_object_key,storage_backend_id,sha256,mime_type,original_filename,trusted_storage_object_key,trusted_storage_object_version FROM payment_documents WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NULL AND security_status='CLEAN' AND storage_binding_state='VERSION_BOUND'`,[documentId,requestId]);
    if(!q.rowCount)throw new NotFoundException("Clean document not found");
    const row=q.rows[0],data=await this.storage.read(row.storage_backend_id,row.trusted_storage_object_key,row.trusted_storage_object_version,row.sha256);
    await this.database.transaction(client=>this.requests.audit(client,actor.id,"DOCUMENT_DOWNLOADED",requestId,request.status,request.status,correlationId,{documentId}));
    return{data,mimeType:row.mime_type,filename:sanitizeFilename(row.original_filename)};
  }

  async history(requestId: string, actor: Principal) {
    await this.requests.get(requestId, actor);
    const result = await this.database.pool.query(
      `SELECT id,logical_document_id,original_filename,mime_type,size_bytes,sha256,document_type,
        version,uploaded_by,uploaded_at,removed_at,
        (security_status='CLEAN' AND storage_binding_state='VERSION_BOUND'
          AND trusted_storage_object_key IS NOT NULL AND trusted_storage_object_version IS NOT NULL) downloadable
       FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NOT NULL
       ORDER BY logical_document_id,version,id`, [requestId]);
    return { items: result.rows.map(row => ({ ...row, historical: true, activeEvidence: false })) };
  }

  async downloadHistorical(requestId: string, documentId: string, actor: Principal, correlationId: string) {
    const request = await this.requests.get(requestId, actor);
    const result = await this.database.pool.query<{
      storage_backend_id: string; trusted_storage_object_key: string; trusted_storage_object_version: string;
      sha256: string; mime_type: string; original_filename: string; version: number; logical_document_id: string;
    }>(
      `SELECT storage_backend_id,trusted_storage_object_key,trusted_storage_object_version,sha256,
        mime_type,original_filename,version,logical_document_id FROM payment_documents
       WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NOT NULL
         AND security_status='CLEAN' AND storage_binding_state='VERSION_BOUND'
         AND trusted_storage_object_key IS NOT NULL AND trusted_storage_object_version IS NOT NULL`,
      [documentId, requestId]);
    if (!result.rowCount) throw new NotFoundException("Downloadable historical document not found");
    const row = result.rows[0];
    const data = await this.storage.read(row.storage_backend_id, row.trusted_storage_object_key,
      row.trusted_storage_object_version, row.sha256);
    await this.database.transaction(client => this.requests.audit(client, actor.id,
      "DOCUMENT_HISTORICAL_DOWNLOADED", requestId, request.status, request.status, correlationId,
      { documentId, logicalDocumentId: row.logical_document_id, version: row.version, historical: true, activeEvidence: false }));
    return { data, mimeType: row.mime_type,
      filename: `historical-v${row.version}-${sanitizeFilename(row.original_filename)}`,
      version: row.version, historical: true, activeEvidence: false };
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

export function assertAllowedDocumentExtension(filename:string,mimeType:string){
  const extension=filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]??"";
  const allowed:Record<string,readonly string[]>={"application/pdf":["pdf"],"image/jpeg":["jpg","jpeg"],"image/png":["png"]};
  if(!allowed[mimeType.trim().toLowerCase()]?.includes(extension))throw new BadRequestException("Document filename extension does not match an allowed file type");
}

async function* oneChunk(data: Buffer): AsyncIterable<Uint8Array> {
  yield data;
}
