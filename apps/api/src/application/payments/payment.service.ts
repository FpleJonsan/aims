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
  decimalToMinor,
  minorToDecimal,
} from "../../domain/finance-context.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { DocumentStorage } from "../../infrastructure/storage/document-storage.js";
import { DOCUMENT_STORAGE } from "../documents/tokens.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import type { PaymentListDto, RecordPaymentDto } from "./payment.dto.js";

@Injectable()
export class PaymentService {
  constructor(
    private readonly db: Postgres,
    private readonly requests: PaymentRequestService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
  ) {}

  private async authorize(
    c: any,
    actor: Principal,
    departmentId: string,
    createdBy?: string,
    amountMinor?: bigint,
  ) {
    const q = await c.query(
      "SELECT 1 FROM payment_authorities a JOIN users u ON u.id=a.user_id AND u.active WHERE a.user_id=$1 AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=$2)AND(a.allow_self_payment OR $1<>$3)AND($4::bigint IS NULL OR a.minimum_amount_minor IS NULL OR $4>=a.minimum_amount_minor)AND($4::bigint IS NULL OR a.maximum_amount_minor IS NULL OR $4<=a.maximum_amount_minor)",
      [actor.id, departmentId, createdBy ?? null, amountMinor?.toString() ?? null],
    );
    if (!q.rowCount)
      throw new ForbiddenException("Payment Operator authority is required");
  }

  async queue(actor: Principal, filter: {departmentId?:string;category?:string;page?:number;pageSize?:number} = {}) {
    const page = filter.page ?? 1,
      pageSize = Math.min(filter.pageSize ?? 25, 100);
    const q = await this.db.pool.query(
      `WITH eligible AS (
        SELECT pr.id,pr.ticket_number,pr.payee,pr.amount,pr.currency,pr.department_id,pr.category,pr.due_date,pr.payment_method,f.status finance_control_status
        FROM payment_requests pr
        JOIN finance_control_runs f ON f.payment_request_id=pr.id AND f.is_current AND f.status='PASSED'
        WHERE pr.status='READY_FOR_PAYMENT'
          AND EXISTS(SELECT 1 FROM payment_authorities a JOIN users u ON u.id=a.user_id AND u.active
            WHERE a.user_id=$1 AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=pr.department_id)
              AND(a.allow_self_payment OR pr.created_by<>$1)
              AND(a.minimum_amount_minor IS NULL OR (pr.amount*100)::bigint>=a.minimum_amount_minor)
              AND(a.maximum_amount_minor IS NULL OR (pr.amount*100)::bigint<=a.maximum_amount_minor))
          AND($2::uuid IS NULL OR pr.department_id=$2)AND($3::text IS NULL OR pr.category=$3)
      ), page_rows AS (
        SELECT * FROM eligible ORDER BY due_date,ticket_number LIMIT $4 OFFSET $5
      )
      SELECT page_rows.*,totals.total::int total FROM(SELECT count(*) total FROM eligible)totals
      LEFT JOIN page_rows ON true ORDER BY page_rows.due_date,page_rows.ticket_number`,
      [actor.id,filter.departmentId??null,filter.category??null,pageSize,(page-1)*pageSize],
    );
    const total = Number(q.rows[0]?.total ?? 0),
      items = q.rows
        .filter((row: any) => row.id !== null)
        .map((row: any) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "total"))),
      totalPages = Math.ceil(total / pageSize);
    return { items, page, pageSize, total, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 };
  }

  async uploadSlip(
    requestId: string,
    file: Express.Multer.File,
    actor: Principal,
    correlationId: string,
  ) {
    if (!file) throw new BadRequestException("A payment slip is required");
    const request = await this.requests.get(requestId, actor);
    await this.authorize(
      this.db.pool,
      actor,
      request.departmentId,
      request.createdBy,
      request.amount ? decimalToMinor(request.amount) : undefined,
    );
    if (request.status !== "READY_FOR_PAYMENT")
      throw new ConflictException("Payment slip requires READY_FOR_PAYMENT");
    const id = randomUUID(),
      logicalId = randomUUID(),
      filename = sanitize(file.originalname);
    const stored = await this.storage.storeQuarantined({
      key: `payment-requests/${requestId}/payment-slips/${id}`,
      declaredContentType: file.mimetype,
      data: oneChunk(file.buffer),
    });
    try {
      await this.db.paymentTransaction(actor.id, correlationId, (c) =>
        c.query("SELECT attach_payment_slip($1,$2,$3,$4,$5,$6,$7,$8)", [
          requestId,
          id,
          logicalId,
          filename,
          stored.key,
          stored.contentType,
          stored.sizeBytes,
          stored.sha256,
        ]),
      );
      return {
        id,
        originalFilename: filename,
        mimeType: stored.contentType,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
      };
    } catch (error) {
      throw this.controlled(error);
    }
  }

  async record(
    requestId: string,
    input: RecordPaymentDto,
    actor: Principal,
    correlationId: string,
  ) {
    let amount: bigint;
    try {
      amount = decimalToMinor(input.amount);
    } catch {
      throw new BadRequestException(
        "Payment amount must be a valid two-decimal amount",
      );
    }
    if (input.currency !== input.currency.toUpperCase())
      throw new BadRequestException("Currency must use uppercase ISO format");
    const date = new Date(`${input.paymentDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date > new Date())
      throw new BadRequestException(
        "Payment date must be valid and not in the future",
      );
    try {
      const id = randomUUID();
      const q = await this.db.paymentTransaction(
        actor.id,
        correlationId,
        (c) =>
          c.query("SELECT record_payment($1,$2,$3,$4,$5,$6,$7,$8,$9) id", [
            requestId,
            id,
            input.commandKey,
            input.paymentDate,
            amount.toString(),
            input.currency,
            input.bankReference,
            input.slipDocumentId,
            input.confirmPossibleDuplicate,
          ]),
        input.commandKey,
      );
      return this.get(q.rows[0].id, actor);
    } catch (error) {
      throw this.controlled(error);
    }
  }

  async list(actor: Principal, input: PaymentListDto) {
    const values: unknown[] = [
      actor.id,
      input.search ?? null,
      input.departmentId ?? null,
      input.category ?? null,
      input.dateFrom ?? null,
      input.dateTo ?? null,
      input.payee ?? null,
      Math.min(input.pageSize, 100),
      (input.page - 1) * Math.min(input.pageSize, 100),
    ];
    const q = await this.db.pool.query(
      `SELECT p.*,d.name department_name,u.display_name recorded_by_name,count(*) OVER() total,
       EXISTS(SELECT 1 FROM payment_authorities pa JOIN users au ON au.id=pa.user_id AND au.active
         WHERE pa.user_id=$1 AND pa.active AND(pa.scope='ORGANIZATION' OR pa.department_id=p.department_id)) finance_access
      FROM payments p JOIN departments d ON d.id=p.department_id JOIN users u ON u.id=p.recorded_by JOIN payment_requests pr ON pr.id=p.payment_request_id
      WHERE (pr.created_by=$1 OR EXISTS(SELECT 1 FROM payment_authorities pa JOIN users au ON au.id=pa.user_id AND au.active WHERE pa.user_id=$1 AND pa.active AND(pa.scope='ORGANIZATION' OR pa.department_id=p.department_id)))
      AND($2::text IS NULL OR p.ticket_number ILIKE '%'||$2||'%' OR p.payee ILIKE '%'||$2||'%' OR(EXISTS(SELECT 1 FROM payment_authorities pa WHERE pa.user_id=$1 AND pa.active AND(pa.scope='ORGANIZATION' OR pa.department_id=p.department_id)) AND p.bank_reference ILIKE '%'||$2||'%'))
      AND($3::uuid IS NULL OR p.department_id=$3)AND($4::text IS NULL OR p.category=$4)AND($5::date IS NULL OR p.payment_date>=$5)AND($6::date IS NULL OR p.payment_date<=$6)AND($7::text IS NULL OR p.payee ILIKE '%'||$7||'%')
      ORDER BY p.payment_date DESC,p.id DESC LIMIT $8 OFFSET $9`,
      values,
    );
    return {
      items: q.rows.map((x: any) => this.present(x, x.finance_access)),
      total: Number(q.rows[0]?.total ?? 0),
      page: input.page,
      pageSize: Math.min(input.pageSize, 100),
    };
  }

  async get(id: string, actor: Principal) {
    const q = await this.db.pool.query<any>(
      `SELECT p.*,pr.created_by,d.name department_name,u.display_name recorded_by_name,ac.source approval_source,f.status finance_control_status,bc.status commitment_status
      FROM payments p JOIN payment_requests pr ON pr.id=p.payment_request_id JOIN departments d ON d.id=p.department_id JOIN users u ON u.id=p.recorded_by
      JOIN approval_cases ac ON ac.id=p.approval_case_id JOIN finance_control_runs f ON f.id=p.finance_control_run_id JOIN budget_commitments bc ON bc.id=p.commitment_id WHERE p.id=$1`,
      [id],
    );
    if (!q.rowCount) throw new NotFoundException("Payment not found");
    const finance = await this.hasPaymentAccess(actor, q.rows[0].department_id);
    if (!finance && q.rows[0].created_by !== actor.id)
      throw new ForbiddenException("Payment access denied");
    return this.present(q.rows[0], finance);
  }
  async downloadSlip(id: string, actor: Principal, correlationId: string) {
    await this.get(id, actor);
    const q = await this.db.pool.query<any>(
      "SELECT d.storage_object_key,d.sha256,d.mime_type,d.original_filename,p.payment_request_id FROM payments p JOIN payment_documents d ON d.id=p.slip_document_id WHERE p.id=$1",
      [id],
    );
    if (!q.rowCount) throw new NotFoundException("Payment slip not found");
    const row = q.rows[0],
      data = await this.storage.readQuarantined(
        row.storage_object_key,
        row.sha256,
      );
    await this.db.transaction((c) =>
      this.requests.audit(
        c,
        actor.id,
        "PAYMENT_SLIP_DOWNLOADED",
        row.payment_request_id,
        "PAID",
        "PAID",
        correlationId,
        { paymentId: id },
      ),
    );
    return { data, mimeType: row.mime_type, filename: row.original_filename };
  }

  async export(actor: Principal, input: PaymentListDto) {
    if (!(await this.isPaymentOperator(actor)))
      throw new ForbiddenException(
        "Payment export requires Payment Operator authority",
      );
    const configuredLimit = Number(process.env.MAX_PAYMENT_EXPORT_ROWS ?? 10_000);
    const exportLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0
      ? Math.min(configuredLimit, 50_000)
      : 10_000;
    const first = await this.list(actor, { ...input, page: 1, pageSize: 100 });
    if (first.total > exportLimit) {
      throw new BadRequestException(
        `Payment export contains ${first.total} rows; narrow the filters below the ${exportLimit}-row operational limit`,
      );
    }
    const items = [...first.items];
    for (let page = 2; items.length < first.total; page += 1) {
      const next = await this.list(actor, { ...input, page, pageSize: 100 });
      items.push(...next.items);
      if (next.items.length === 0) break;
    }
    const headers = [
      "Ticket Number",
      "Payment Date",
      "Payee",
      "Department",
      "Category",
      "Purpose",
      "Amount",
      "Currency",
      "Payment Method",
      "Bank Reference",
      "Status",
      "Recorded By",
      "Recorded At",
    ];
    return [
      headers,
      ...items.map((x: any) => [
        x.ticketNumber,
        x.paymentDate,
        x.payee,
        x.departmentName,
        x.category,
        x.purpose,
        x.amount,
        x.currency,
        x.paymentMethod,
        x.bankReference,
        x.status,
        x.recordedByName,
        x.recordedAt,
      ]),
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n");
  }

  private async isPaymentOperator(actor: Principal) {
    return Boolean(
      (
        await this.db.pool.query(
          "SELECT 1 FROM payment_authorities a JOIN users u ON u.id=a.user_id AND u.active WHERE a.user_id=$1 AND a.active",
          [actor.id],
        )
      ).rowCount,
    );
  }
  private async hasPaymentAccess(actor: Principal, departmentId: string) {
    return Boolean((await this.db.pool.query(
      "SELECT 1 FROM payment_authorities a JOIN users u ON u.id=a.user_id AND u.active WHERE a.user_id=$1 AND a.active AND(a.scope='ORGANIZATION' OR a.department_id=$2)",
      [actor.id, departmentId],
    )).rowCount);
  }
  private present(r: any, full: boolean) {
    return {
      id: r.id,
      paymentRequestId: r.payment_request_id,
      ticketNumber: r.ticket_number,
      paymentDate: r.payment_date,
      payee: r.payee,
      departmentId: r.department_id,
      departmentName: r.department_name,
      category: r.category,
      purpose: r.purpose,
      amount: minorToDecimal(r.amount_minor),
      currency: r.currency,
      paymentMethod: r.payment_method,
      bankReference: full
        ? r.bank_reference
        : `••••${String(r.bank_reference).slice(-4)}`,
      slipDocumentId: r.slip_document_id,
      status: r.status,
      recordedBy: r.recorded_by,
      recordedByName: r.recorded_by_name,
      recordedAt: r.recorded_at,
      approvalSource: r.approval_source,
      financeControlStatus: r.finance_control_status,
      commitmentStatus: r.commitment_status,
      ledgerEntryId: r.ledger_entry_id,
    };
  }
  private controlled(error: unknown) {
    const message =
      error instanceof Error ? error.message : "Payment command failed";
    if (message.includes("authority") || message.includes("executor"))
      return new ForbiddenException(message);
    return new ConflictException(message);
  }
}
function sanitize(name: string) {
  return (
    (name.replace(/\\/g, "/").split("/").at(-1) ?? "payment-slip")
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 255) || "payment-slip"
  );
}
async function* oneChunk(data: Buffer): AsyncIterable<Uint8Array> {
  yield data;
}
function csv(value: unknown) {
  const x = String(value ?? "");
  return `"${x.replaceAll('"', '""')}"`;
}
