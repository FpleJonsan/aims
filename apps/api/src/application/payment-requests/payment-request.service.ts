import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import {
  assertSubmittable,
  canEditDraft,
  canReadRequest,
  formatTicketNumber,
  type PaymentRequest,
  type Principal,
} from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type {
  CapturePaymentRequestDto,
  ListPaymentRequestsDto,
} from "./payment-request.dto.js";

type RequestRow = {
  id: string;
  ticket_number: string | null;
  status: PaymentRequest["status"];
  payee: string | null;
  purpose: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  department_id: string;
  due_date: string | Date | null;
  payment_method: string | null;
  payment_details: string | null;
  remark: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  submitted_at: Date | null;
  row_version: number;
};

@Injectable()
export class PaymentRequestService {
  constructor(private readonly database: Postgres) {}

  async initiate(
    actor: Principal,
    correlationId: string,
  ): Promise<PaymentRequest> {
    if (!actor.roles.some((role) => role === "REQUESTER" || role === "ADMIN")) {
      throw new ForbiddenException("Requester permission required");
    }
    return this.database.transaction(async (client) => {
      const id = randomUUID();
      const result = await client.query<RequestRow>(
        `
        INSERT INTO payment_requests (id, status, department_id, created_by)
        VALUES ($1, 'DRAFT', $2, $3) RETURNING *
      `,
        [id, actor.departmentId, actor.id],
      );
      await this.audit(
        client,
        actor.id,
        "REQUEST_INITIATED",
        id,
        null,
        "DRAFT",
        correlationId,
        {},
      );
      await this.audit(
        client,
        actor.id,
        "REQUEST_CREATED",
        id,
        null,
        "DRAFT",
        correlationId,
        {},
      );
      return mapRequest(result.rows[0]);
    });
  }

  async update(
    id: string,
    input: CapturePaymentRequestDto,
    actor: Principal,
    correlationId: string,
  ): Promise<PaymentRequest> {
    return this.database.transaction(async (client) => {
      const current = await this.lockRequest(client, id);
      if (!canEditDraft(actor, current))
        throw new ForbiddenException("Draft editing is not permitted");
      if (
        input.departmentId &&
        input.departmentId !== actor.departmentId &&
        !actor.roles.includes("ADMIN")
      ) {
        throw new ForbiddenException(
          "Cross-department assignment is not permitted",
        );
      }
      const nextDepartment = input.departmentId ?? current.departmentId;
      const department = await client.query(
        "SELECT 1 FROM departments WHERE id = $1 AND active = true",
        [nextDepartment],
      );
      if (!department.rowCount)
        throw new BadRequestException("Department is invalid or inactive");
      const values = {
        payee: clean(input.payee, current.payee),
        purpose: clean(input.purpose, current.purpose),
        category: clean(input.category, current.category),
        amount: input.amount ?? current.amount,
        currency: input.currency ?? current.currency,
        departmentId: nextDepartment,
        dueDate: input.dueDate ?? current.dueDate,
        paymentMethod: clean(input.paymentMethod, current.paymentMethod),
        paymentDetails: clean(input.paymentDetails, current.paymentDetails),
        remark: clean(input.remark, current.remark),
      };
      const result = await client.query<RequestRow>(
        `
        UPDATE payment_requests SET payee=$2, purpose=$3, category=$4, amount=$5, currency=$6,
          department_id=$7, due_date=$8, payment_method=$9, payment_details=$10, remark=$11,
          updated_at=now(), row_version=row_version+1 WHERE id=$1 RETURNING *
      `,
        [
          id,
          values.payee,
          values.purpose,
          values.category,
          values.amount,
          values.currency,
          values.departmentId,
          values.dueDate,
          values.paymentMethod,
          values.paymentDetails,
          values.remark,
        ],
      );
      await this.audit(
        client,
        actor.id,
        "REQUEST_UPDATED",
        id,
        "DRAFT",
        "DRAFT",
        correlationId,
        { fields: Object.keys(input) },
      );
      return mapRequest(result.rows[0]);
    });
  }

  async submit(
    id: string,
    actor: Principal,
    correlationId: string,
  ): Promise<PaymentRequest> {
    return this.database.transaction(async (client) => {
      const request = await this.lockRequest(client, id);
      if (!canEditDraft(actor, request)) {
        if (request.status !== "DRAFT")
          throw new ConflictException("Request has already left DRAFT");
        throw new ForbiddenException("Request submission is not permitted");
      }
      try {
        assertSubmittable(request);
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : "Request is incomplete",
        );
      }
      const year = businessYear(
        new Date(),
        process.env.BUSINESS_TIMEZONE ?? "Asia/Kuala_Lumpur",
      );
      const counter = await client.query<{ last_value: string }>(
        `
        INSERT INTO ticket_counters (business_year, last_value) VALUES ($1, 1)
        ON CONFLICT (business_year) DO UPDATE SET last_value = ticket_counters.last_value + 1
        RETURNING last_value
      `,
        [year],
      );
      const ticketNumber = formatTicketNumber(
        year,
        BigInt(counter.rows[0].last_value),
      );
      const result = await client.query<RequestRow>(
        `
        UPDATE payment_requests SET status='SUBMITTED', ticket_number=$2, submitted_at=now(),
          updated_at=now(), row_version=row_version+1 WHERE id=$1 AND status='DRAFT' RETURNING *
      `,
        [id, ticketNumber],
      );
      if (!result.rowCount)
        throw new ConflictException("Concurrent submission prevented");
      await this.audit(
        client,
        actor.id,
        "REQUEST_SUBMITTED",
        id,
        "DRAFT",
        "SUBMITTED",
        correlationId,
        { ticketNumber },
      );
      return mapRequest(result.rows[0]);
    });
  }

  async get(
    id: string,
    actor: Principal,
  ): Promise<PaymentRequest & { audit: unknown[]; documents: unknown[] }> {
    const result = await this.database.pool.query<RequestRow>(
      "SELECT * FROM payment_requests WHERE id=$1",
      [id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Payment request not found");
    const request = mapRequest(result.rows[0]);
    if (!canReadRequest(actor, request)) {
      const approvalAccess = await this.database.pool.query(
        `SELECT 1 FROM approval_cases ac JOIN approval_steps s ON s.approval_case_id=ac.id JOIN payment_requests pr ON pr.id=ac.payment_request_id
        JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
        JOIN approval_authorities aa ON aa.user_id=$2 AND aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
        JOIN users u ON u.id=aa.user_id AND u.active
        WHERE ac.payment_request_id=$1 AND ac.is_current AND ac.status='PENDING' AND s.status='ACTIVE'
          AND $2<>pr.created_by AND pr.status='PENDING_APPROVAL' AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=$3)
          AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=fc.request_amount_minor)
          AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=fc.request_amount_minor)
          AND (s.minimum_amount_minor IS NULL OR s.minimum_amount_minor<=fc.request_amount_minor)
          AND (s.maximum_amount_minor IS NULL OR s.maximum_amount_minor>=fc.request_amount_minor) LIMIT 1`,
        [id, actor.id, request.departmentId],
      );
      if (!approvalAccess.rowCount)
        throw new NotFoundException("Payment request not found");
    }
    const [audit, documents] = await Promise.all([
      this.database.pool.query(
        "SELECT id, actor_id, action, previous_state, new_state, occurred_at, correlation_id, safe_metadata FROM audit_events WHERE entity_type=$1 AND entity_id=$2 ORDER BY occurred_at",
        ["PAYMENT_REQUEST", id],
      ),
      this.database.pool.query(
        "SELECT id, original_filename, mime_type, size_bytes, sha256, document_type, version, uploaded_by, uploaded_at FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL ORDER BY uploaded_at",
        [id],
      ),
    ]);
    return { ...request, audit: audit.rows, documents: documents.rows };
  }

  async list(
    actor: Principal,
    query: ListPaymentRequestsDto,
  ): Promise<{ items: PaymentRequest[]; page: number; pageSize: number }> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const search = query.search?.trim() ? `%${query.search.trim()}%` : null;
    const broadAccess =
      actor.roles.includes("ADMIN") || actor.roles.includes("FINANCE");
    const result = await this.database.pool.query<RequestRow>(
      `
      SELECT * FROM payment_requests
      WHERE ($1::boolean OR (department_id=$2 AND created_by=$3) OR EXISTS(
        SELECT 1 FROM approval_cases ac JOIN approval_steps s ON s.approval_case_id=ac.id JOIN finance_context_snapshots fc ON fc.id=ac.finance_context_snapshot_id
        JOIN approval_authorities aa ON aa.user_id=$3 AND aa.active AND aa.authority_role=s.required_role AND aa.authority_scope=s.authority_scope
        JOIN users u ON u.id=aa.user_id AND u.active
        WHERE ac.payment_request_id=payment_requests.id AND ac.is_current AND ac.status='PENDING' AND s.status='ACTIVE' AND $3<>payment_requests.created_by
          AND (aa.authority_scope='ORGANIZATION' OR aa.department_id=payment_requests.department_id)
          AND (aa.minimum_amount_minor IS NULL OR aa.minimum_amount_minor<=fc.request_amount_minor)
          AND (aa.maximum_amount_minor IS NULL OR aa.maximum_amount_minor>=fc.request_amount_minor)
          AND (s.minimum_amount_minor IS NULL OR s.minimum_amount_minor<=fc.request_amount_minor)
          AND (s.maximum_amount_minor IS NULL OR s.maximum_amount_minor>=fc.request_amount_minor)))
        AND ($4::text IS NULL OR status=$4)
        AND ($5::text IS NULL OR ticket_number ILIKE $5 OR payee ILIKE $5 OR purpose ILIKE $5)
      ORDER BY created_at DESC LIMIT $6 OFFSET $7
    `,
      [
        broadAccess,
        actor.departmentId,
        actor.id,
        query.status ?? null,
        search,
        pageSize,
        (page - 1) * pageSize,
      ],
    );
    return { items: result.rows.map(mapRequest), page, pageSize };
  }

  async lockRequest(client: PoolClient, id: string): Promise<PaymentRequest> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      id,
    ]);
    const result = await client.query<RequestRow>(
      "SELECT * FROM payment_requests WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!result.rowCount)
      throw new NotFoundException("Payment request not found");
    return mapRequest(result.rows[0]);
  }

  async audit(
    client: PoolClient,
    actorId: string | null,
    action: string,
    entityId: string,
    previousState: string | null,
    newState: string | null,
    correlationId: string,
    metadata: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_events
      (id, actor_id, action, entity_type, entity_id, previous_state, new_state, correlation_id, safe_metadata)
      VALUES ($1,$2,$3,'PAYMENT_REQUEST',$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        actorId,
        action,
        entityId,
        previousState,
        newState,
        correlationId,
        JSON.stringify(metadata),
      ],
    );
  }
}

function mapRequest(row: RequestRow): PaymentRequest {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    status: row.status,
    payee: row.payee,
    purpose: row.purpose,
    category: row.category,
    amount: row.amount,
    currency: row.currency,
    departmentId: row.department_id,
    dueDate:
      row.due_date instanceof Date
        ? row.due_date.toISOString().slice(0, 10)
        : row.due_date,
    paymentMethod: row.payment_method,
    paymentDetails: row.payment_details,
    remark: row.remark,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    rowVersion: row.row_version,
  };
}

function clean(
  value: string | undefined,
  fallback: string | null,
): string | null {
  return value === undefined ? fallback : value.trim() || null;
}

export function businessYear(date: Date, timeZone: string): number {
  const year = new Intl.DateTimeFormat("en", {
    year: "numeric",
    timeZone,
  }).format(date);
  return Number(year);
}
