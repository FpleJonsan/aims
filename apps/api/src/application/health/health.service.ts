import { Injectable } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";

export const EXPECTED_SCHEMA_VERSION = 57;

@Injectable()
export class HealthService {
  constructor(private readonly database: Postgres) {}

  liveness() { return { status: "ok" as const }; }

  async readiness() {
    const checks: Record<string, { status: "ready" | "not_ready" | "disabled"; detail?: string }> = {};
    checks.postgresql = await this.databaseCheck(this.database.pool);
    checks.schema = await this.schemaCheck();
    checks.financeExecutor = this.database.financePool
      ? await this.databaseCheck(this.database.financePool)
      : { status: "not_ready", detail: "FINANCE_DATABASE_URL is not configured" };
    checks.paymentExecutor = this.database.paymentPool
      ? await this.databaseCheck(this.database.paymentPool)
      : { status: "not_ready", detail: "PAYMENT_DATABASE_URL is not configured" };
    checks.storage = process.env.STORAGE_DRIVER
      ? { status: "ready", detail: process.env.STORAGE_DRIVER }
      : { status: "not_ready", detail: "STORAGE_DRIVER is not configured" };
    checks.malwareScanner = process.env.MALWARE_SCANNER_DRIVER
      ? {status:"ready",detail:process.env.MALWARE_SCANNER_DRIVER}
      : {status:"not_ready",detail:"MALWARE_SCANNER_DRIVER is not configured"};

    const ai = await this.aiState();
    checks.ai = ai.error
      ? { status: "not_ready", detail: ai.error }
      : ai.enabled
      ? process.env.OPENAI_API_KEY
        ? { status: "ready", detail: "enabled and provider configured" }
        : { status: "not_ready", detail: "enabled but provider is not configured" }
      : { status: "disabled", detail: "AI_MASTER is OFF" };
    checks.telegram = process.env.TELEGRAM_APPROVAL_ENABLED === "true"
      ? process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_CALLBACK_SECRET
        ? { status: "ready", detail: "enabled and configured" }
        : { status: "not_ready", detail: "enabled but configuration is incomplete" }
      : { status: "disabled", detail: "Telegram approval is disabled" };

    const required = [checks.postgresql, checks.schema, checks.financeExecutor, checks.paymentExecutor, checks.storage,checks.malwareScanner, checks.ai, checks.telegram];
    return { status: required.some((x) => x.status === "not_ready") ? "not_ready" as const : "ready" as const, checks };
  }

  private async databaseCheck(pool: { query(query: string): Promise<unknown> }) {
    try { await pool.query("SELECT 1"); return { status: "ready" as const }; }
    catch { return { status: "not_ready" as const, detail: "connection failed" }; }
  }

  private async schemaCheck() {
    try {
      const result = await this.database.pool.query<{ version: number; migration_id: string }>(
        "SELECT version,migration_id FROM aims_schema_version WHERE singleton=true",
      );
      const current = Number(result.rows[0]?.version ?? 0);
      return current === EXPECTED_SCHEMA_VERSION
        ? { status: "ready" as const, detail: `schema ${current}` }
        : { status: "not_ready" as const, detail: `schema ${current || "missing"}; expected ${EXPECTED_SCHEMA_VERSION}` };
    } catch {
      return { status: "not_ready" as const, detail: "required schema version cannot be verified" };
    }
  }

  private async aiState(): Promise<{ enabled: boolean; error?: string }> {
    try {
      const result = await this.database.pool.query<{ enabled: boolean }>("SELECT enabled FROM ai_feature_configuration WHERE feature='AI_MASTER'");
      return { enabled: Boolean(result.rows[0]?.enabled) };
    } catch { return { enabled: false, error: "AI configuration schema cannot be read" }; }
  }
}
