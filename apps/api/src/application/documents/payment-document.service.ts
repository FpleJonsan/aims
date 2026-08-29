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
import type { DocumentMalwareScanner } from "./document-quarantine-service.js";
import { DOCUMENT_MALWARE_SCANNER,DOCUMENT_STORAGE } from "./tokens.js";
import { Inject } from "@nestjs/common";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";

type SecurityDocumentRow = {
  removed_at:string|null;uploaded_by:string;document_type:string|null;security_status:string;
  scan_attempt:number;storage_object_key:string;sha256:string;detected_mime_type:string;
};
type DownloadDocumentRow = {storage_object_key:string;sha256:string;mime_type:string;original_filename:string};

@Injectable()
export class PaymentDocumentService {
  constructor(
    private readonly database: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENT_MALWARE_SCANNER) private readonly scanner:DocumentMalwareScanner,
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
          (id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by,storage_provider,declared_mime_type,detected_mime_type,security_status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'LOCAL',$12,$6,'QUARANTINED')
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
      await this.storage.delete(stored.key).catch(()=>undefined);
      if (error instanceof Error && "code" in error && error.code === "23505") {
        throw new ConflictException("The same document is already attached");
      }
      throw error;
    }
  }

  async scan(requestId:string,documentId:string,actor:Principal,correlationId:string){
    const classification=await this.database.pool.query<{document_type:string;version:number;sha256:string;storage_object_key:string;detected_mime_type:string}>(
      "SELECT document_type,version,sha256,storage_object_key,detected_mime_type FROM payment_documents WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NULL",
      [documentId,requestId],
    );
    if(!classification.rowCount)throw new NotFoundException("Document not found");
    if(classification.rows[0].document_type==="PAYMENT_SLIP")return this.scanPaymentSlip(requestId,documentId,classification.rows[0],actor,correlationId);
    const started=await this.database.transaction(async client=>{
      const request=await this.requests.lockRequest(client,requestId);
      const row=await client.query<SecurityDocumentRow>(`SELECT * FROM payment_documents WHERE id=$1 AND payment_request_id=$2 FOR UPDATE`,[documentId,requestId]);
      if(!row.rowCount||row.rows[0].removed_at)throw new NotFoundException("Document not found");
      const document=row.rows[0];
      const clarificationStillOpen = request.status === "NEEDS_CLARIFICATION"
        && request.createdBy === actor.id
        && Boolean((await client.query("SELECT 1 FROM validation_clarifications WHERE payment_request_id=$1 AND status='OPEN'", [requestId])).rowCount);
      const mayScan=document.uploaded_by===actor.id&&(canEditDraft(actor,request)||clarificationStillOpen||document.document_type==="PAYMENT_SLIP");
      if(!mayScan)throw new ForbiddenException("Document security check is not authorized");
      if(!["QUARANTINED","SCAN_FAILED"].includes(document.security_status))throw new ConflictException("Document security check is not available in its current state");
      const attempt=Number(document.scan_attempt)+1;
      await client.query(`UPDATE payment_documents SET security_status='SCANNING',scan_attempt=$3,scan_started_at=now(),scan_completed_at=NULL,scan_engine=NULL,scan_reference=NULL,scan_failure_code=NULL WHERE id=$1 AND payment_request_id=$2`,[documentId,requestId,attempt]);
      await this.requests.audit(client,actor.id,"DOCUMENT_SCAN_STARTED",requestId,request.status,request.status,correlationId,{documentId,attempt});
      return{...document,attempt,requestStatus:request.status};
    });
    let verdict:"CLEAN"|"REJECTED"|"SCAN_FAILED"="SCAN_FAILED",engine:string|null=null,reference:string|null=null,failureCode:string|null=null,activeKey:string|null=null;
    try{
      const data=await this.storage.readQuarantined(started.storage_object_key,started.sha256);
      const result=await this.scanner.scan({key:started.storage_object_key,sha256:started.sha256,contentType:started.detected_mime_type,data});
      engine=result.engine;reference=result.reference;
      if(result.verdict==="CLEAN"){
        const promoted=await this.storage.promoteQuarantined({quarantinedKey:started.storage_object_key,destinationKey:`payment-requests/${requestId}/documents/${documentId}`,expectedSha256:started.sha256});
        activeKey=promoted.key;verdict="CLEAN";
      }else if(result.verdict==="INFECTED")verdict="REJECTED";
      else failureCode="SCANNER_UNAVAILABLE";
    }catch(error){failureCode=safeFailureCode(error);}
    return this.database.transaction(async client=>{
      const request=await this.requests.lockRequest(client,requestId);
      const current=await client.query<SecurityDocumentRow>(`SELECT * FROM payment_documents WHERE id=$1 AND payment_request_id=$2 FOR UPDATE`,[documentId,requestId]);
      if(!current.rowCount)throw new NotFoundException("Document not found");
      const row=current.rows[0];
      if(row.security_status!=="SCANNING"||Number(row.scan_attempt)!==started.attempt)throw new ConflictException("Document security result is stale");
      if(row.removed_at){verdict="SCAN_FAILED";failureCode="DOCUMENT_REMOVED_DURING_SCAN";activeKey=null;}
      await client.query(`UPDATE payment_documents SET security_status=$3::varchar,storage_object_key=CASE WHEN $3::varchar='CLEAN' THEN $4::varchar ELSE storage_object_key END,scan_completed_at=now(),scan_engine=$5,scan_reference=$6,scan_failure_code=$7 WHERE id=$1 AND payment_request_id=$2`,[documentId,requestId,verdict,activeKey,engine,reference,failureCode]);
      await this.requests.audit(client,actor.id,verdict==="CLEAN"?"DOCUMENT_MARKED_CLEAN":verdict==="REJECTED"?"DOCUMENT_REJECTED":"DOCUMENT_SCAN_FAILED",requestId,request.status,request.status,correlationId,{documentId,attempt:started.attempt,status:verdict,failureCode});
      return{id:documentId,securityStatus:verdict};
    });
  }

  private async scanPaymentSlip(requestId:string,documentId:string,document:{version:number;sha256:string;storage_object_key:string;detected_mime_type:string},actor:Principal,correlationId:string){
    const attempt=await this.database.paymentTransaction(actor.id,correlationId,async client=>{
      const q=await client.query<{begin_payment_slip_security_scan:number}>("SELECT begin_payment_slip_security_scan($1,$2,$3,$4)",[requestId,documentId,document.version,document.sha256]);
      return Number(q.rows[0].begin_payment_slip_security_scan);
    });
    let verdict:"CLEAN"|"REJECTED"|"SCAN_FAILED"="SCAN_FAILED",engine:string|null=null,reference:string|null=null,failureCode:string|null=null;
    try{
      const data=await this.storage.readQuarantined(document.storage_object_key,document.sha256);
      const result=await this.scanner.scan({key:document.storage_object_key,sha256:document.sha256,contentType:document.detected_mime_type,data});
      engine=result.engine;reference=result.reference;
      if(result.verdict==="CLEAN")verdict="CLEAN";else if(result.verdict==="INFECTED")verdict="REJECTED";else failureCode="SCANNER_UNAVAILABLE";
    }catch(error){failureCode=safeFailureCode(error);}
    const completed=await this.database.paymentTransaction(actor.id,correlationId,async client=>{
      const q=await client.query<{complete_payment_slip_security_scan:string}>("SELECT complete_payment_slip_security_scan($1,$2,$3,$4,$5,$6,$7,$8,$9)",[requestId,documentId,document.version,document.sha256,attempt,verdict,engine,reference,failureCode]);
      return q.rows[0].complete_payment_slip_security_scan;
    });
    return{id:documentId,securityStatus:completed};
  }

  async download(requestId:string,documentId:string,actor:Principal,correlationId:string){
    const request=await this.requests.get(requestId,actor);
    const q=await this.database.pool.query<DownloadDocumentRow>(`SELECT storage_object_key,sha256,mime_type,original_filename FROM payment_documents WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NULL AND security_status='CLEAN'`,[documentId,requestId]);
    if(!q.rowCount)throw new NotFoundException("Clean document not found");
    const row=q.rows[0],data=await this.storage.read(row.storage_object_key,row.sha256);
    await this.database.transaction(client=>this.requests.audit(client,actor.id,"DOCUMENT_DOWNLOADED",requestId,request.status,request.status,correlationId,{documentId}));
    return{data,mimeType:row.mime_type,filename:sanitizeFilename(row.original_filename)};
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

function safeFailureCode(error:unknown){
  const message=error instanceof Error?error.message:"";
  if(message.includes("integrity"))return"STORAGE_INTEGRITY_FAILURE";
  if(message.includes("ENOENT"))return"STORAGE_OBJECT_MISSING";
  return"SCANNER_OR_STORAGE_FAILURE";
}

export function assertAllowedDocumentExtension(filename:string,mimeType:string){
  const extension=filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]??"";
  const allowed:Record<string,readonly string[]>={"application/pdf":["pdf"],"image/jpeg":["jpg","jpeg"],"image/png":["png"]};
  if(!allowed[mimeType.trim().toLowerCase()]?.includes(extension))throw new BadRequestException("Document filename extension does not match an allowed file type");
}

async function* oneChunk(data: Buffer): AsyncIterable<Uint8Array> {
  yield data;
}
