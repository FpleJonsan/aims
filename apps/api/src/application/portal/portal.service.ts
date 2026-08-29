import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { RequesterListDto } from "./portal.dto.js";
import { competitionIdentityDisplayName } from "../auth/competition-identity-presentation.js";

type Capability = "financeAnalysis"|"approval"|"financeControl"|"payment"|"reporting"|"policyAdmin";

@Injectable()
export class PortalService {
  constructor(private readonly db: Postgres) {}

  async session(actor: Principal) {
    const [user, authority] = await Promise.all([
      this.db.pool.query<{external_subject:string;email:string;display_name:string;department_name:string}>(
        `SELECT u.external_subject,u.email,u.display_name,d.name department_name
         FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=$1 AND u.active`, [actor.id]),
      this.db.pool.query<Record<Capability, boolean>>(
        `SELECT
          EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role='FINANCE') finance_analysis,
          EXISTS(SELECT 1 FROM approval_authorities WHERE user_id=$1 AND active) approval,
          EXISTS(SELECT 1 FROM finance_control_authorities WHERE user_id=$1 AND active) finance_control,
          EXISTS(SELECT 1 FROM payment_authorities WHERE user_id=$1 AND active) payment,
          EXISTS(SELECT 1 FROM finance_reporting_authorities WHERE user_id=$1 AND active) reporting,
          EXISTS(SELECT 1 FROM user_roles WHERE user_id=$1 AND role='ADMIN') policy_admin`, [actor.id]),
    ]);
    if (!user.rowCount) throw new ForbiddenException("Active identity required");
    const row = authority.rows[0] as unknown as Record<string, boolean>;
    const capabilities = {
      financeAnalysis: row.finance_analysis,
      approval: row.approval,
      financeControl: row.finance_control,
      payment: row.payment,
      reporting: row.reporting,
      policyAdmin: row.policy_admin,
    };
    const requester = actor.roles.includes("REQUESTER");
    // Technical policy administration is not operational Finance authority.
    const finance = capabilities.financeAnalysis || capabilities.approval ||
      capabilities.financeControl || capabilities.payment || capabilities.reporting;
    return {
      user: { id:actor.id, subject:user.rows[0].external_subject, email:user.rows[0].email, displayName:competitionIdentityDisplayName(user.rows[0].external_subject,user.rows[0].display_name), department:user.rows[0].department_name },
      workspaces: { requester, finance }, capabilities,
    };
  }

  private requester(actor: Principal) {
    if (!actor.roles.includes("REQUESTER"))
      throw new ForbiddenException("Requester workspace entitlement required");
  }

  async requesterSummary(actor: Principal) {
    this.requester(actor);
    const result = await this.db.pool.query<{status:string;count:number}>(
      `SELECT status,count(*)::int count FROM payment_requests
       WHERE created_by=$1 AND department_id=$2 GROUP BY status`, [actor.id,actor.departmentId]);
    const statuses = Object.fromEntries(result.rows.map((row)=>[row.status,row.count]));
    return {
      myRequests: result.rows.reduce((total,row)=>total+row.count,0),
      drafts: statuses.DRAFT??0,
      awaitingReview: (statuses.SUBMITTED??0)+(statuses.VALIDATING??0),
      needsClarification: statuses.NEEDS_CLARIFICATION??0,
      pendingApproval: statuses.PENDING_APPROVAL??0,
      approvedReady: (statuses.APPROVED??0)+(statuses.FINANCE_CHECK??0)+(statuses.FINANCE_HOLD??0)+(statuses.READY_FOR_PAYMENT??0),
      readyForPayment: statuses.READY_FOR_PAYMENT??0,
      inProgress: (statuses.SUBMITTED??0)+(statuses.VALIDATING??0)+(statuses.PENDING_APPROVAL??0)+(statuses.APPROVED??0)+(statuses.FINANCE_CHECK??0)+(statuses.FINANCE_HOLD??0),
      paid: statuses.PAID??0,
    };
  }

  async requesterList(actor: Principal, input: RequesterListDto) {
    this.requester(actor);
    const page=Math.max(1,Number(input.page??1)), pageSize=Math.min(100,Math.max(1,Number(input.pageSize??20)));
    const search=input.search?.trim()?`%${input.search.trim()}%`:null;
    const parameters=[actor.id,actor.departmentId,input.status??null,search,input.dateFrom??null,input.dateTo??null];
    const where=`WHERE created_by=$1 AND department_id=$2 AND($3::text IS NULL OR status=$3)
      AND($4::text IS NULL OR ticket_number ILIKE $4 OR payee ILIKE $4 OR purpose ILIKE $4)
      AND($5::date IS NULL OR COALESCE(submitted_at,created_at)::date>=$5)
      AND($6::date IS NULL OR COALESCE(submitted_at,created_at)::date<=$6)`;
    const [rows,count]=await Promise.all([
      this.db.pool.query(`${`SELECT id,ticket_number,status,payee,purpose,amount,currency,due_date,created_at,updated_at,submitted_at FROM payment_requests ${where}`} ORDER BY updated_at DESC,id LIMIT $7 OFFSET $8`,[...parameters,pageSize,(page-1)*pageSize]),
      this.db.pool.query<{total:number}>(`SELECT count(*)::int total FROM payment_requests ${where}`,parameters),
    ]);
    return {items:rows.rows,page,pageSize,total:count.rows[0].total,totalPages:Math.ceil(count.rows[0].total/pageSize)};
  }

  async requesterDetail(actor: Principal, id: string) {
    this.requester(actor);
    const request=await this.db.pool.query(
      `SELECT id,ticket_number,status,payee,purpose,category,amount,currency,department_id,due_date,payment_method,remark,created_at,updated_at,submitted_at
       FROM payment_requests WHERE id=$1 AND created_by=$2 AND department_id=$3`,[id,actor.id,actor.departmentId]);
    if(!request.rowCount) throw new NotFoundException("Payment request not found");
    const [documents,clarifications,activity,payment]=await Promise.all([
      this.db.pool.query(`SELECT id,original_filename,mime_type,size_bytes,document_type,version,uploaded_at,security_status FROM payment_documents WHERE payment_request_id=$1 AND removed_at IS NULL ORDER BY uploaded_at`,[id]),
      this.db.pool.query(`SELECT * FROM (
        SELECT id,clarification_type,COALESCE(required_response,reason) question,status,requested_at,response,responded_at FROM validation_clarifications WHERE payment_request_id=$1
        UNION ALL SELECT id,clarification_type,required_response question,status,requested_at,response,responded_at FROM approval_clarifications WHERE payment_request_id=$1
        UNION ALL SELECT id,clarification_type,required_justification question,status,requested_at,justification response,supplied_at responded_at FROM policy_exceptions WHERE payment_request_id=$1 AND requested_role='REQUESTER'
       ) requester_clarifications ORDER BY requested_at`,[id]),
      this.db.pool.query(`SELECT action,previous_state,new_state,occurred_at FROM audit_events WHERE entity_type='PAYMENT_REQUEST' AND entity_id=$1 ORDER BY occurred_at`,[id]),
      this.db.pool.query(`SELECT payment_date,status,amount_minor,currency,payment_method,recorded_at FROM payments WHERE payment_request_id=$1`,[id]),
    ]);
    return {request:request.rows[0],documents:documents.rows,clarifications:clarifications.rows,activity:activity.rows,payment:payment.rows[0]??null};
  }
}
