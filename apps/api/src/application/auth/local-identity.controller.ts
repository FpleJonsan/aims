import { Body, Controller, Get, NotFoundException, Post, Req, Res } from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import type { Request,Response } from "express";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { competitionIdentityDisplayName } from "./competition-identity-presentation.js";
import { aimsEnvironment } from "./auth-environment.js";
import { SessionService } from "./session.service.js";

class LocalLoginDto { @IsString() @MinLength(1) @MaxLength(255) subject!:string; }

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
  policy_admin: boolean;
};

@Controller("auth")
export class LocalIdentityController {
  constructor(private readonly database: Postgres,private readonly sessions:SessionService) {}

  @Get("local-identities")
  async list() {
    const environment=aimsEnvironment();
    if (environment === "production"||environment==="staging") {
      throw new NotFoundException();
    }

    const competitionMode = environment === "competition";
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
        EXISTS(SELECT 1 FROM finance_reporting_authorities ra WHERE ra.user_id=u.id AND ra.active) reporting,
        EXISTS(SELECT 1 FROM user_roles ur WHERE ur.user_id=u.id AND ur.role='ADMIN') policy_admin
      FROM users u
      JOIN departments d ON d.id=u.department_id
      WHERE u.active AND (CASE WHEN $1 THEN
        u.external_subject IN ('demo.requester','demo.finance') OR u.external_subject LIKE 'competition.%'
        ELSE u.external_subject IN ('demo.requester','demo.finance','demo.approver','demo.admin')
          AND EXISTS(SELECT 1 FROM user_external_identities x WHERE x.user_id=u.id AND x.provider='local' AND x.issuer='aims-local') END)
      ORDER BY CASE u.external_subject
        WHEN 'demo.requester' THEN 1 WHEN 'demo.finance' THEN 2 WHEN 'demo.approver' THEN 3 ELSE 4 END,
        u.display_name
    `, [competitionMode]);

    return {
      mode: competitionMode ? "COMPETITION" as const : "LOCAL" as const,
      identities: result.rows.map((row) => {
        const finance = row.finance_analysis || row.approval || row.finance_control || row.payment || row.reporting;
        const persona = row.requester && finance ? "Requester & Finance"
          : row.requester ? "Requester"
          : row.approval && !row.finance_analysis && !row.finance_control && !row.payment && !row.reporting ? "Approver"
          : row.finance_control && !row.finance_analysis && !row.payment && !row.reporting ? "Finance Controller"
          : row.payment && !row.finance_analysis && !row.reporting ? "Payment Operator"
          : row.reporting && !row.finance_analysis ? "Reporting Manager"
          : row.finance_analysis ? "Finance Analyst"
          : row.policy_admin ? "Technical Administrator"
          : "Authorized User";
        return {
          subject: row.subject,
          displayName: competitionIdentityDisplayName(row.subject, row.display_name),
          department: row.department,
          persona,
          workspaces: [row.requester ? "Requester" : null, finance ? "Finance" : null].filter(Boolean),
        };
      }),
    };
  }

  @Post("local-login")
  async login(@Body() body:LocalLoginDto,@Req() request:Request,@Res({passthrough:true}) response:Response){
    const principal=await this.sessions.localLogin(body.subject,request,response);
    return {authenticated:true,userId:principal.id};
  }

  @Post("logout")
  async logout(@Req() request:Request,@Res({passthrough:true}) response:Response){await this.sessions.logout(request,response);return {authenticated:false};}
}
