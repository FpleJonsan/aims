import { Controller, Get, NotFoundException } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";

type LocalIdentityRow = {
  subject: string;
  display_name: string;
  department: string;
  requester: boolean;
  finance_analysis: boolean;
  approval: boolean;
  finance_control: boolean;
  payment: boolean;
  reporting: boolean;
};

@Controller("auth")
export class LocalIdentityController {
  constructor(private readonly database: Postgres) {}

  @Get("local-identities")
  async list() {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }

    const result = await this.database.pool.query<LocalIdentityRow>(`
      SELECT
        u.external_subject subject,
        u.display_name,
        d.name department,
        EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='REQUESTER') requester,
        EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='FINANCE') finance_analysis,
        EXISTS(SELECT 1 FROM approval_authorities aa WHERE aa.user_id=u.id AND aa.active) approval,
        EXISTS(SELECT 1 FROM finance_control_authorities fa WHERE fa.user_id=u.id AND fa.active) finance_control,
        EXISTS(SELECT 1 FROM payment_authorities pa WHERE pa.user_id=u.id AND pa.active) payment,
        EXISTS(SELECT 1 FROM finance_reporting_authorities ra WHERE ra.user_id=u.id AND ra.active) reporting
      FROM users u
      JOIN departments d ON d.id=u.department_id
      WHERE u.active AND u.external_subject IN ('demo.requester','demo.finance','demo.approver')
      ORDER BY CASE u.external_subject
        WHEN 'demo.requester' THEN 1 WHEN 'demo.finance' THEN 2 ELSE 3 END
    `);

    return {
      mode: "LOCAL_DEMO" as const,
      identities: result.rows.map((row) => {
        const finance = row.finance_analysis || row.approval || row.finance_control || row.payment || row.reporting;
        const persona = row.requester && finance ? "Requester & Finance" : row.requester ? "Requester" : row.approval && !row.finance_analysis ? "Approver" : "Finance Manager";
        return {
          subject: row.subject,
          displayName: row.display_name,
          department: row.department,
          persona,
          workspaces: [row.requester ? "Requester" : null, finance ? "Finance" : null].filter(Boolean),
        };
      }),
    };
  }
}
