import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canEditDraft, type Principal } from '../../domain/payment-request.js';
import { Postgres } from '../../infrastructure/database/postgres.js';
import type { DocumentStorage } from '../../infrastructure/storage/document-storage.js';
import { DOCUMENT_STORAGE } from './tokens.js';
import { Inject } from '@nestjs/common';
import { PaymentRequestService } from '../payment-requests/payment-request.service.js';

@Injectable()
export class PaymentDocumentService {
  constructor(
    private readonly database: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  async upload(requestId: string, file: Express.Multer.File, documentType: string | undefined, actor: Principal, correlationId: string): Promise<unknown> {
    const request = await this.requests.get(requestId, actor);
    if (!canEditDraft(actor, request)) throw new ForbiddenException('Documents can only be changed on an authorized DRAFT');
    const normalizedDocumentType = documentType?.trim() || null;
    if (normalizedDocumentType && normalizedDocumentType.length > 64) {
      throw new BadRequestException('Document type must not exceed 64 characters');
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
        if (!canEditDraft(actor, locked)) throw new ConflictException('Request changed while the document was uploading');
        const result = await client.query(`INSERT INTO payment_documents
          (id,payment_request_id,logical_document_id,original_filename,storage_object_key,mime_type,size_bytes,sha256,document_type,version,uploaded_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)
          RETURNING id, original_filename, mime_type, size_bytes, sha256, document_type, version, uploaded_by, uploaded_at`,
        [documentId, requestId, logicalDocumentId, safeName, stored.key, stored.contentType, stored.sizeBytes, stored.sha256, normalizedDocumentType, actor.id]);
        await this.requests.audit(client, actor.id, 'DOCUMENT_UPLOADED', requestId, 'DRAFT', 'DRAFT', correlationId, { documentId, sha256: stored.sha256, version: 1 });
        return result.rows[0];
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new ConflictException('The same document is already attached');
      }
      throw error;
    }
  }

  async remove(requestId: string, documentId: string, actor: Principal, correlationId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request)) throw new ForbiddenException('Documents can only be changed on an authorized DRAFT');
      const result = await client.query('UPDATE payment_documents SET removed_at=now() WHERE id=$1 AND payment_request_id=$2 AND removed_at IS NULL RETURNING id', [documentId, requestId]);
      if (!result.rowCount) throw new NotFoundException('Document not found');
      await this.requests.audit(client, actor.id, 'DOCUMENT_REMOVED', requestId, 'DRAFT', 'DRAFT', correlationId, { documentId });
    });
  }
}

function sanitizeFilename(filename: string): string {
  const leaf = filename.replace(/\\/g, '/').split('/').at(-1) ?? 'document';
  const safe = leaf.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (safe || 'document').slice(0, 255);
}

async function* oneChunk(data: Buffer): AsyncIterable<Uint8Array> { yield data; }
