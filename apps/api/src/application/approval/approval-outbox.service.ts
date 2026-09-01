/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";
import {
  APPROVAL_CHANNEL,
  type ApprovalChannel,
  TelegramDeliveryError,
} from "./telegram-approval.channel.js";
import {metrics,operationalLog} from "../../infrastructure/observability/telemetry.js";
@Injectable()
export class ApprovalOutboxService {
  private readonly workerId = randomUUID();
  private lastHealthSampleAt = 0;
  constructor(
    private readonly db: Postgres,
    @Inject(APPROVAL_CHANNEL) private readonly channel: ApprovalChannel,
  ) {}
  async dispatch(limit = 20) {
    await this.updateHealth();
    const results = [];
    for (let i = 0; i < Math.min(limit, 100); i++) {
      const claimed = await this.claim();
      if (!claimed) break;
      results.push(await this.deliver(claimed));
    }
    return { processed: results.length, results };
  }
  private async updateHealth(){
    if(Date.now()-this.lastHealthSampleAt<60_000)return;
    this.lastHealthSampleAt=Date.now();
    try{
      const [active,terminal]=await Promise.all([
        this.db.pool.query(`SELECT count(*)FILTER(WHERE status='PENDING')::int pending,count(*)FILTER(WHERE status='FAILED_RETRYABLE')::int retrying,count(*)FILTER(WHERE status='PROCESSING')::int claimed,COALESCE(extract(epoch FROM now()-min(created_at)FILTER(WHERE status IN('PENDING','FAILED_RETRYABLE'))),0)::bigint oldest FROM notification_outbox WHERE status IN('PENDING','FAILED_RETRYABLE','PROCESSING')`),
        this.db.pool.query(`SELECT count(*)::int terminal FROM notification_outbox WHERE status='FAILED_TERMINAL'`),
      ]),row={...(active.rows[0]??{}),...(terminal.rows[0]??{})};
      for(const [key,state] of [["pending","PENDING"],["retrying","RETRYING"],["claimed","CLAIMED"],["terminal","TERMINAL"]] as const)metrics.gauge("aims_worker_backlog",{workload:"TELEGRAM_DELIVERY",state},Number(row[key]??0));
      metrics.gauge("aims_worker_oldest_pending_seconds",{workload:"TELEGRAM_DELIVERY"},Number(row.oldest??0));
    }catch{/* normal dispatch remains authoritative */}
  }
  private async claim() {
    const leaseSeconds = boundedInteger(
        process.env.OUTBOX_PROCESSING_LEASE_SECONDS,
        120,
        1,
        3600,
      ),
      claimToken = randomUUID();
    const claimed=await this.db.transaction(async (c) => {
      const q = await c.query<any>(
        `SELECT * FROM notification_outbox
         WHERE
           (status IN('PENDING','FAILED_RETRYABLE') AND attempts<5 AND next_attempt_at<=now()) OR
           (status='PROCESSING' AND claimed_at<now()-interval '1 second' * $1)
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [leaseSeconds],
      );
      if (!q.rowCount) return null;
      const result = await c.query<any>(
        `UPDATE notification_outbox SET status='PROCESSING',attempts=attempts+1,
         claimed_at=now(),claim_token=$2,claimed_by=$3,last_error_code=NULL
         WHERE id=$1 RETURNING *`,
        [q.rows[0].id, claimToken, this.workerId],
      );
      return {row:result.rows[0],expiredLeaseRecovered:q.rows[0].status==="PROCESSING"};
    });
    if(claimed?.expiredLeaseRecovered)metrics.counter("aims_worker_lease_recoveries_total",{workload:"TELEGRAM_DELIVERY"});
    return claimed?.row??null;
  }
  private callback(id: string) {
    const secret =
      process.env.TELEGRAM_CALLBACK_SECRET ??
      process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) throw new Error("TELEGRAM_CALLBACK_SECRET_NOT_CONFIGURED");
    return `${id}.${createHmac("sha256", secret).update(id).digest("base64url").slice(0, 24)}`;
  }
  private async deliver(row: any) {
    const started=performance.now(),correlationId=typeof row.payload?.correlationId==="string"?row.payload.correlationId:randomUUID();
    metrics.counter("aims_worker_work_total",{workload:"TELEGRAM_DELIVERY",outcome:"CLAIMED",failure_category:"NONE"});
    try {
      const prepared = await this.db.transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        const info = await c.query<any>(
          `SELECT t.telegram_chat_id,pr.ticket_number,pr.amount,pr.currency,pr.purpose,s.id step_id,s.approval_case_id FROM telegram_identity_bindings t JOIN notification_outbox o ON o.recipient_user_id=t.user_id JOIN approval_steps s ON s.id=o.aggregate_id JOIN approval_cases ac ON ac.id=s.approval_case_id JOIN payment_requests pr ON pr.id=ac.payment_request_id WHERE o.id=$1 AND t.status='ACTIVE' AND s.status='ACTIVE' AND ac.is_current FOR UPDATE OF o`,
          [row.id],
        );
        if (!info.rowCount || row.claim_token === null)
          throw new Error("RECIPIENT_OR_STEP_NOT_ACTIVE");
        const owned = await c.query(
          "SELECT 1 FROM notification_outbox WHERE id=$1 AND status='PROCESSING' AND claim_token=$2 AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)",
          [row.id, row.claim_token],
        );
        if (!owned.rowCount) throw new Error("STALE_OUTBOX_CLAIM");
        const callbacks: any = {};
        for (const action of ["APPROVE", "REJECT", "REQUEST_CLARIFICATION"]) {
          let token = (
            await c.query<any>(
              "SELECT id FROM approval_action_tokens WHERE approval_step_id=$1 AND recipient_user_id=$2 AND action=$3 AND status='ACTIVE' AND expires_at>now() FOR UPDATE",
              [info.rows[0].step_id, row.recipient_user_id, action],
            )
          ).rows[0];
          if (!token) {
            await c.query(
              "UPDATE approval_action_tokens SET status='EXPIRED' WHERE approval_step_id=$1 AND recipient_user_id=$2 AND action=$3 AND status='ACTIVE' AND expires_at<=now()",
              [info.rows[0].step_id, row.recipient_user_id, action],
            );
            const id = randomUUID(),
              callback = this.callback(id);
            await c.query(
              "INSERT INTO approval_action_tokens(id,token_hash,approval_case_id,approval_step_id,recipient_user_id,action,expires_at,status)VALUES($1,$2,$3,$4,$5,$6,now()+interval '15 minutes','ACTIVE')",
              [
                id,
                createHash("sha256").update(callback).digest("hex"),
                info.rows[0].approval_case_id,
                info.rows[0].step_id,
                row.recipient_user_id,
                action,
              ],
            );
            token = { id };
          }
          callbacks[action] = this.callback(token.id);
        }
        return { ...info.rows[0], callbacks };
      });
      await this.channel.send({
        chatId: String(prepared.telegram_chat_id),
        ticketNumber: prepared.ticket_number,
        amount: prepared.amount,
        currency: prepared.currency,
        purpose: prepared.purpose,
        callbacks: {
          approve: prepared.callbacks.APPROVE,
          reject: prepared.callbacks.REJECT,
          clarify: prepared.callbacks.REQUEST_CLARIFICATION,
        },
      });
      const completed = await this.db.transaction(async(c)=>{
        await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
        return c.query(
          `UPDATE notification_outbox SET status='SENT',sent_at=now(),last_error_code=NULL,
           claimed_at=NULL,claim_token=NULL,claimed_by=NULL
           WHERE id=$1 AND status='PROCESSING' AND claim_token=$2
             AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)`,
          [row.id,row.claim_token],
        );
      });
      if (!completed.rowCount)
        return { id: row.id, status: "STALE_CLAIM" };
      await this.audit(row, "APPROVAL_NOTIFICATION_SENT", null);
      metrics.counter("aims_worker_work_total",{workload:"TELEGRAM_DELIVERY",outcome:"SUCCESS",failure_category:"NONE"});
      metrics.counter("aims_provider_operations_total",{provider:"TELEGRAM",surface:"APPROVAL",outcome:"SUCCESS",failure_category:"NONE"});
      return { id: row.id, status: "SENT" };
    } catch (error) {
      const code = safeDeliveryCode(error);
      if (code === "STALE_OUTBOX_CLAIM")
        return { id: row.id, status: "STALE_CLAIM" };
      const deliveryError =
          error instanceof TelegramDeliveryError ? error : undefined,
        terminal =
          row.attempts >= 5 ||
          deliveryError?.retryable === false ||
          (/^TELEGRAM_HTTP_4\d\d$/.test(code) && code !== "TELEGRAM_HTTP_429") ||
          code === "RECIPIENT_OR_STEP_NOT_ACTIVE",
        retryDelay = Math.max(
          1,
          Math.min(
            deliveryError?.retryAfterSeconds ?? 300,
            boundedInteger(
              process.env.TELEGRAM_RETRY_MAX_DELAY_SECONDS,
              3_600,
              1,
              86_400,
            ),
          ),
        ),
        failed = await this.db.transaction(async(c)=>{
          await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
          return c.query(
            `UPDATE notification_outbox SET status=$3::varchar,next_attempt_at=CASE WHEN $3::varchar='FAILED_RETRYABLE' THEN now()+make_interval(secs=>$5) ELSE next_attempt_at END,
             last_error_code=$4,claimed_at=NULL,claim_token=NULL,claimed_by=NULL
             WHERE id=$1 AND status='PROCESSING' AND claim_token=$2
               AND claim_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)`,
            [
            row.id,
            row.claim_token,
            terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
            code,
            retryDelay,
            ],
          );
        });
      if (!failed.rowCount)
        return { id: row.id, status: "STALE_CLAIM" };
      await this.audit(
        row,
        terminal
          ? "APPROVAL_NOTIFICATION_FAILED_TERMINAL"
          : "APPROVAL_NOTIFICATION_FAILED",
        code,
      );
      const category=terminal?"TERMINAL":deliveryError?.message==="TELEGRAM_TIMEOUT"?"TIMEOUT":deliveryError?.message==="TELEGRAM_RATE_LIMITED"?"RATE_LIMIT":"PROVIDER";
      metrics.counter("aims_worker_work_total",{workload:"TELEGRAM_DELIVERY",outcome:terminal?"TERMINAL_FAILURE":"RETRYABLE_FAILURE",failure_category:category});
      metrics.counter("aims_provider_operations_total",{provider:"TELEGRAM",surface:"APPROVAL",outcome:"FAILURE",failure_category:category});
      operationalLog("warn","provider_operation_failed",{provider:"TELEGRAM",surface:"APPROVAL",channel:"TELEGRAM",correlation_id:correlationId,failure_category:category,safe_error_code:code});
      return {
        id: row.id,
        status: terminal ? "FAILED_TERMINAL" : "FAILED_RETRYABLE",
        code,
      };
    } finally {metrics.histogram("aims_worker_work_duration_seconds",{workload:"TELEGRAM_DELIVERY"},(performance.now()-started)/1000);metrics.histogram("aims_provider_operation_duration_seconds",{provider:"TELEGRAM",surface:"APPROVAL"},(performance.now()-started)/1000)}
  }
  private async audit(row: any, action: string, errorCode: string | null) {
    const requestId = row.payload?.requestId;
    if (!requestId) return;
    await this.db.pool.query(
      `INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata)VALUES($1,NULL,$2,'PAYMENT_REQUEST',$3,$4,$5)`,
      [
        randomUUID(),
        action,
        requestId,
        typeof row.payload?.correlationId==="string"?row.payload.correlationId:randomUUID(),
        JSON.stringify({ outboxId: row.id, channel: "TELEGRAM", errorCode }),
      ],
    );
  }
}

export function safeDeliveryCode(error:unknown){
  const raw=error instanceof Error?error.message:"DELIVERY_FAILED";
  return (error instanceof TelegramDeliveryError||["STALE_OUTBOX_CLAIM","RECIPIENT_OR_STEP_NOT_ACTIVE","TELEGRAM_CALLBACK_SECRET_NOT_CONFIGURED"].includes(raw))&&/^[A-Z0-9_]{1,64}$/.test(raw)?raw:"DELIVERY_FAILED";
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}
