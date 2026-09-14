import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { PoolClient } from "pg";
import { canEditDraft, type Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { redactSensitiveData } from "../../infrastructure/configuration/secret-boundary.js";
import { PaymentRequestService } from "../payment-requests/payment-request.service.js";
import type {
  CreateClaimItemDto,
  ReorderClaimItemsDto,
  UpdateClaimItemDto,
} from "./claim-item.dto.js";

type ClaimItemRow = {
  id: string;
  payment_request_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  category: string;
  project_id: string | null;
  department_id: string;
  currency: string;
  amount: string;
  tax_amount: string | null;
  description: string | null;
  remark: string | null;
  payment_method: string | null;
  display_order: number;
  row_version: number;
};

@Injectable()
export class ClaimItemService {
  constructor(
    private readonly database: Postgres,
    private readonly requests: PaymentRequestService,
  ) {}

  async list(requestId: string, actor: Principal): Promise<unknown[]> {
    await this.requests.get(requestId, actor);
    const result = await this.database.pool.query<ClaimItemRow>(
      `SELECT * FROM claim_items WHERE payment_request_id=$1 AND internal_status='ACTIVE'
       ORDER BY display_order, created_at`,
      [requestId],
    );
    return result.rows.map(mapClaimItem);
  }

  async create(
    requestId: string,
    input: CreateClaimItemDto,
    actor: Principal,
    correlationId: string,
    ip: string | null = null,
  ): Promise<unknown> {
    return this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request))
        throw new ForbiddenException("Claim items can only be changed on an authorized DRAFT");
      await this.assertDepartmentActive(client, input.departmentId);
      if (input.projectId) await this.assertProjectActive(client, input.projectId);
      const id = randomUUID();
      const nextOrder = await client.query<{ next: number }>(
        "SELECT COALESCE(max(display_order)+1,0) AS next FROM claim_items WHERE payment_request_id=$1 AND internal_status='ACTIVE'",
        [requestId],
      );
      let result;
      try {
        result = await client.query<ClaimItemRow>(
          `INSERT INTO claim_items
           (id, payment_request_id, invoice_number, invoice_date, category, project_id, department_id,
            currency, amount, tax_amount, description, remark, payment_method, display_order, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            id,
            requestId,
            input.invoiceNumber?.trim() || null,
            input.invoiceDate ?? null,
            input.category.trim(),
            input.projectId ?? null,
            input.departmentId,
            input.currency,
            input.amount,
            input.taxAmount ?? null,
            input.description?.trim() || null,
            input.remark?.trim() || null,
            input.paymentMethod?.trim() || null,
            nextOrder.rows[0].next,
            actor.id,
          ],
        );
      } catch (error) {
        throw translateClaimItemError(error);
      }
      await this.auditClaim(
        client,
        actor,
        "CLAIM_ITEM_ADDED",
        requestId,
        request.status,
        correlationId,
        ip,
        { claimItemId: id, category: input.category, amount: input.amount, currency: input.currency },
      );
      return mapClaimItem(result.rows[0]);
    });
  }

  async update(
    requestId: string,
    claimItemId: string,
    input: UpdateClaimItemDto,
    actor: Principal,
    correlationId: string,
    ip: string | null = null,
  ): Promise<unknown> {
    return this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request))
        throw new ForbiddenException("Claim items can only be changed on an authorized DRAFT");
      const current = await this.lockClaimItem(client, requestId, claimItemId);
      const departmentId = input.departmentId ?? current.department_id;
      const projectId = input.projectId !== undefined ? input.projectId : current.project_id;
      if (input.departmentId) await this.assertDepartmentActive(client, departmentId);
      if (projectId) await this.assertProjectActive(client, projectId);
      const values = {
        invoiceNumber: clean(input.invoiceNumber, current.invoice_number),
        invoiceDate: input.invoiceDate ?? current.invoice_date,
        category: clean(input.category, current.category) ?? current.category,
        projectId,
        departmentId,
        currency: input.currency ?? current.currency,
        amount: input.amount ?? current.amount,
        taxAmount: input.taxAmount ?? current.tax_amount,
        description: clean(input.description, current.description),
        remark: clean(input.remark, current.remark),
        paymentMethod: clean(input.paymentMethod, current.payment_method),
      };
      let result;
      try {
        result = await client.query<ClaimItemRow>(
          `UPDATE claim_items SET invoice_number=$3, invoice_date=$4, category=$5, project_id=$6,
             department_id=$7, currency=$8, amount=$9, tax_amount=$10, description=$11, remark=$12,
             payment_method=$13, updated_at=now(), row_version=row_version+1
           WHERE id=$1 AND payment_request_id=$2 RETURNING *`,
          [
            claimItemId,
            requestId,
            values.invoiceNumber,
            values.invoiceDate,
            values.category,
            values.projectId,
            values.departmentId,
            values.currency,
            values.amount,
            values.taxAmount,
            values.description,
            values.remark,
            values.paymentMethod,
          ],
        );
      } catch (error) {
        throw translateClaimItemError(error);
      }
      await this.auditClaim(
        client,
        actor,
        "CLAIM_ITEM_UPDATED",
        requestId,
        request.status,
        correlationId,
        ip,
        { claimItemId, fields: Object.keys(input) },
      );
      return mapClaimItem(result.rows[0]);
    });
  }

  async remove(
    requestId: string,
    claimItemId: string,
    actor: Principal,
    correlationId: string,
    ip: string | null = null,
  ): Promise<void> {
    return this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request))
        throw new ForbiddenException("Claim items can only be changed on an authorized DRAFT");
      await this.lockClaimItem(client, requestId, claimItemId);
      await client.query(
        "UPDATE claim_items SET internal_status='REMOVED', updated_at=now(), row_version=row_version+1 WHERE id=$1 AND payment_request_id=$2",
        [claimItemId, requestId],
      );
      await this.auditClaim(
        client,
        actor,
        "CLAIM_ITEM_REMOVED",
        requestId,
        request.status,
        correlationId,
        ip,
        { claimItemId },
      );
    });
  }

  async reorder(
    requestId: string,
    input: ReorderClaimItemsDto,
    actor: Principal,
    correlationId: string,
    ip: string | null = null,
  ): Promise<unknown[]> {
    return this.database.transaction(async (client) => {
      const request = await this.requests.lockRequest(client, requestId);
      if (!canEditDraft(actor, request))
        throw new ForbiddenException("Claim items can only be changed on an authorized DRAFT");
      const active = await client.query<{ id: string }>(
        "SELECT id FROM claim_items WHERE payment_request_id=$1 AND internal_status='ACTIVE'",
        [requestId],
      );
      const activeIds = new Set(active.rows.map((row) => row.id));
      const givenIds = new Set(input.items.map((item) => item.id));
      if (activeIds.size !== givenIds.size || [...activeIds].some((id) => !givenIds.has(id)))
        throw new BadRequestException("Reorder must include every active claim item exactly once");
      for (const item of input.items) {
        await client.query(
          "UPDATE claim_items SET display_order=$3, updated_at=now(), row_version=row_version+1 WHERE id=$1 AND payment_request_id=$2",
          [item.id, requestId, item.displayOrder],
        );
      }
      await this.auditClaim(
        client,
        actor,
        "CLAIM_ITEMS_REORDERED",
        requestId,
        request.status,
        correlationId,
        ip,
        { order: input.items.map((item) => item.id) },
      );
      const result = await client.query<ClaimItemRow>(
        "SELECT * FROM claim_items WHERE payment_request_id=$1 AND internal_status='ACTIVE' ORDER BY display_order, created_at",
        [requestId],
      );
      return result.rows.map(mapClaimItem);
    });
  }

  // Mirrors user-management.service.ts's richer audit pattern (actor role and
  // display-name snapshot, source IP) rather than the plain PAYMENT_REQUEST
  // audit helper -- claim changes must record who, their role at the time,
  // and where from, not just the correlation id.
  private async auditClaim(
    client: PoolClient,
    actor: Principal,
    action: string,
    requestId: string,
    status: string,
    correlationId: string,
    ip: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const actorRow = await client.query<{ display_name: string }>(
      "SELECT display_name FROM users WHERE id=$1",
      [actor.id],
    );
    await client.query(
      `INSERT INTO audit_events
       (id, actor_id, action, entity_type, entity_id, previous_state, new_state, correlation_id, safe_metadata, source_ip, actor_role_snapshot, actor_display_name_snapshot)
       VALUES ($1,$2,$3,'PAYMENT_REQUEST',$4,$5,$5,$6,$7,$8,$9,$10)`,
      [
        randomUUID(),
        actor.id,
        action,
        requestId,
        status,
        correlationId,
        JSON.stringify(redactSensitiveData(metadata)),
        ip,
        actor.roles,
        actorRow.rows[0]?.display_name ?? null,
      ],
    );
  }

  private async lockClaimItem(
    client: PoolClient,
    requestId: string,
    claimItemId: string,
  ): Promise<ClaimItemRow> {
    const result = await client.query<ClaimItemRow>(
      "SELECT * FROM claim_items WHERE id=$1 AND payment_request_id=$2 AND internal_status='ACTIVE' FOR UPDATE",
      [claimItemId, requestId],
    );
    if (!result.rowCount) throw new NotFoundException("Claim item not found");
    return result.rows[0];
  }

  private async assertDepartmentActive(client: PoolClient, departmentId: string): Promise<void> {
    const result = await client.query("SELECT 1 FROM departments WHERE id=$1 AND active=true", [departmentId]);
    if (!result.rowCount) throw new BadRequestException("Department is invalid or inactive");
  }

  private async assertProjectActive(client: PoolClient, projectId: string): Promise<void> {
    const result = await client.query(
      "SELECT 1 FROM master_data_projects WHERE id=$1 AND active=true AND deleted_at IS NULL",
      [projectId],
    );
    if (!result.rowCount) throw new BadRequestException("Project is invalid or inactive");
  }
}

function mapClaimItem(row: ClaimItemRow) {
  return {
    id: row.id,
    paymentRequestId: row.payment_request_id,
    invoiceNumber: row.invoice_number,
    invoiceDate: row.invoice_date,
    category: row.category,
    projectId: row.project_id,
    departmentId: row.department_id,
    currency: row.currency,
    amount: row.amount,
    taxAmount: row.tax_amount,
    description: row.description,
    remark: row.remark,
    paymentMethod: row.payment_method,
    displayOrder: row.display_order,
    rowVersion: row.row_version,
  };
}

function clean(value: string | null | undefined, fallback: string | null): string | null {
  return value === undefined ? fallback : (value?.trim() || null);
}

function translateClaimItemError(error: unknown): Error {
  if (error instanceof Error && error.message.includes("must share one currency")) {
    return new ConflictException("All claim items on a request must share one currency");
  }
  return error instanceof Error ? error : new Error(String(error));
}
