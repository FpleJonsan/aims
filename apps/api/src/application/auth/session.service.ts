import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import type { Principal, Role } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { aimsEnvironment } from "./auth-environment.js";
import {metrics} from "../../infrastructure/observability/telemetry.js";
import { loadRuntimeFoundationConfig } from "../../infrastructure/configuration/runtime-foundation.js";

export const SESSION_COOKIE = "aims_session";
export const CSRF_COOKIE = "aims_csrf";

type AuthenticatedSession = { principal: Principal; sessionId: string; csrfTokenHash: string; authenticationMethod:string };
type SessionIdentity = {identity_id:string;user_id:string;department_id:string;role:Role|null};
export type IssuedCorporateSession={principal:Principal;token:string;csrf:string;lifetime:number};

@Injectable()
export class SessionService {
  constructor(private readonly database: Postgres) {}

  async localLogin(subject:string, request:Request, response:Response):Promise<Principal> {
    if (aimsEnvironment() !== "local") throw new UnauthorizedException("Local authentication is unavailable");
    this.requireAllowedOrigin(request);
    const identity=await this.database.pool.query<{identity_id:string;user_id:string;department_id:string;role:Role|null}>(`
      SELECT x.id identity_id,u.id user_id,u.department_id,ur.role
      FROM user_external_identities x
      JOIN users u ON u.id=x.user_id AND u.active=true
      LEFT JOIN user_roles ur ON ur.user_id=u.id
      WHERE x.provider='local' AND x.issuer='aims-local' AND x.subject=$1
    `,[subject]);
    if(!identity.rowCount){metrics.counter("aims_domain_operations_total",{operation:"LOGIN",outcome:"FAILURE",failure_category:"AUTHENTICATION",channel:"WEB"});await this.audit("LOCAL_AUTHENTICATION_FAILURE",request,null,null,null);throw new UnauthorizedException("Unknown or inactive local identity");}
    const row=identity.rows[0];
    const principal=await this.createSession(identity.rows,"LOCAL_ADAPTER",request,response);
    await this.database.pool.query(`UPDATE users SET last_login_at=now() WHERE id=$1`,[row.user_id]);
    await this.audit("LOCAL_AUTHENTICATION_SUCCESS",request,row.user_id,row.identity_id,principal.roles);
    metrics.counter("aims_domain_operations_total",{operation:"LOGIN",outcome:"SUCCESS",failure_category:"NONE",channel:"WEB"});
    return principal;
  }

  async createCorporateSessionRecord(identity:SessionIdentity[],client:PoolClient):Promise<IssuedCorporateSession>{
    if(!identity.length)throw new UnauthorizedException("Unknown or inactive corporate identity");
    return this.insertSession(identity,"CORPORATE_PROVIDER",client);
  }

  setCorporateSessionCookies(response:Response,session:IssuedCorporateSession):void{this.setCookies(response,session.token,session.csrf,session.lifetime)}

  async createPasswordSessionRecord(identity:SessionIdentity[],client:Pick<PoolClient,"query">,rememberMe:boolean):Promise<IssuedCorporateSession>{
    if(!identity.length)throw new UnauthorizedException("Unknown or inactive local identity");
    return this.insertSession(identity,"LOCAL_PASSWORD",client,rememberMe);
  }

  setPasswordSessionCookies(response:Response,session:IssuedCorporateSession):void{this.setCookies(response,session.token,session.csrf,session.lifetime)}

  async revokeAllForUser(userId:string,request:Request):Promise<void>{
    const revoked=await this.database.pool.query<{external_identity_id:string}>(
      `UPDATE aims_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL RETURNING external_identity_id`,[userId]);
    if(revoked.rowCount)await this.audit("SESSIONS_REVOKED_FOR_PASSWORD_RESET",request,userId,revoked.rows[0].external_identity_id,null);
  }

  async authenticate(request:Request):Promise<AuthenticatedSession> {
    const token=this.cookies(request)[SESSION_COOKIE];
    if(!token){metrics.counter("aims_domain_operations_total",{operation:"SESSION_AUTHENTICATE",outcome:"FAILURE",failure_category:"AUTHENTICATION",channel:"WEB"});throw new UnauthorizedException("Authentication required")}
    const result=await this.database.transaction(async(c)=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      return c.query<{session_id:string;csrf_token_hash:string;authentication_method:string;user_id:string;department_id:string;active:boolean;role:Role|null}>(`
        SELECT s.id session_id,s.csrf_token_hash,s.authentication_method,u.id user_id,u.department_id,u.active,ur.role
        FROM aims_sessions s JOIN users u ON u.id=s.user_id
        LEFT JOIN user_roles ur ON ur.user_id=u.id
        WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
          AND s.issued_generation=(SELECT generation FROM aims_recovery_generation WHERE singleton)
      `,[this.hash(token)]);
    });
    if(!result.rowCount){metrics.counter("aims_domain_operations_total",{operation:"SESSION_AUTHENTICATE",outcome:"FAILURE",failure_category:"AUTHENTICATION",channel:"WEB"});throw new UnauthorizedException("Session is invalid or expired")}
    if(!result.rows[0].active){await this.audit("INACTIVE_USER_REJECTED",request,result.rows[0].user_id,null,null);throw new UnauthorizedException("Unknown or inactive user");}
    return {sessionId:result.rows[0].session_id,csrfTokenHash:result.rows[0].csrf_token_hash,authenticationMethod:result.rows[0].authentication_method,principal:{
      id:result.rows[0].user_id,departmentId:result.rows[0].department_id,
      roles:result.rows.flatMap(row=>row.role?[row.role]:[]),
    }};
  }

  verifyCsrf(request:Request, expectedHash:string):void {
    if(["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase()))return;
    this.requireAllowedOrigin(request);
    const cookie=this.cookies(request)[CSRF_COOKIE], header=request.header("x-aims-csrf");
    if(!cookie||!header||!this.equal(cookie,header)||!this.equal(this.hash(cookie),expectedHash)){
      metrics.counter("aims_domain_operations_total",{operation:"CSRF_ORIGIN",outcome:"FAILURE",failure_category:"AUTHENTICATION",channel:"WEB"});
      throw new UnauthorizedException("CSRF validation failed");
    }
  }

  async logout(request:Request,response:Response):Promise<void>{
    const token=this.cookies(request)[SESSION_COOKIE];
    if(token){
      const existing=await this.database.pool.query<{csrf_token_hash:string}>(
        `SELECT csrf_token_hash FROM aims_sessions WHERE token_hash=$1`,[this.hash(token)]);
      if(!existing.rowCount){this.clearCookies(response);return;}
      this.verifyCsrf(request,existing.rows[0].csrf_token_hash);
      const revoked=await this.database.pool.query<{user_id:string;external_identity_id:string}>(
        `UPDATE aims_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE token_hash=$1 RETURNING user_id,external_identity_id`,[this.hash(token)]);
      if(revoked.rowCount)await this.audit("LOGOUT",request,revoked.rows[0].user_id,revoked.rows[0].external_identity_id,null);
    }
    this.clearCookies(response);
  }

  async revoke(sessionId:string,request:Request):Promise<void>{
    const revoked=await this.database.pool.query<{user_id:string;external_identity_id:string}>(
      `UPDATE aims_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING user_id,external_identity_id`,[sessionId]);
    if(revoked.rowCount)await this.audit("SESSION_REVOKED",request,revoked.rows[0].user_id,revoked.rows[0].external_identity_id,null);
  }

  async listMine(userId:string,currentSessionId:string){
    const result=await this.database.pool.query<{id:string;authentication_method:string;created_at:string;expires_at:string}>(
      `SELECT id,authentication_method,created_at,expires_at FROM aims_sessions
       WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()
       ORDER BY created_at DESC,id`,[userId]);
    return result.rows.map(row=>({id:row.id,authenticationMethod:row.authentication_method,createdAt:row.created_at,expiresAt:row.expires_at,current:row.id===currentSessionId}));
  }

  async revokeMine(userId:string,sessionId:string,request:Request){
    const result=await this.database.pool.query<{external_identity_id:string}>(
      `UPDATE aims_sessions SET revoked_at=now() WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL RETURNING external_identity_id`,[sessionId,userId]);
    if(!result.rowCount)throw new NotFoundException("Active session not found");
    await this.audit("SESSION_REVOKED",request,userId,result.rows[0].external_identity_id,null);
    return{revoked:true,current:sessionId===(request as Request&{aimsSessionId?:string}).aimsSessionId};
  }

  async revokeOthers(userId:string,currentSessionId:string,request:Request){
    const result=await this.database.pool.query<{external_identity_id:string}>(
      `UPDATE aims_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL AND expires_at>now() RETURNING external_identity_id`,[userId,currentSessionId]);
    if(result.rowCount)await this.audit("OTHER_SESSIONS_REVOKED",request,userId,result.rows[0].external_identity_id,null);
    return{revoked:result.rowCount??0};
  }

  async requirePasswordChange(userId:string):Promise<boolean>{
    const result=await this.database.pool.query<{force_reset:boolean}>(`SELECT force_reset FROM password_credentials WHERE user_id=$1`,[userId]);
    return result.rows[0]?.force_reset===true;
  }

  private localLifetimeSeconds():number{
    const configured=Number(process.env.LOCAL_SESSION_LIFETIME_SECONDS??28800);
    if(!Number.isInteger(configured)||configured<300||configured>604800)throw new Error("LOCAL_SESSION_LIFETIME_SECONDS must be between 300 and 604800");
    return configured;
  }
  private passwordLifetimeSeconds(rememberMe:boolean):number{
    const configured=Number(process.env.LOCAL_PASSWORD_SESSION_LIFETIME_SECONDS??28800);
    if(!Number.isInteger(configured)||configured<300||configured>604800)throw new Error("LOCAL_PASSWORD_SESSION_LIFETIME_SECONDS must be between 300 and 604800");
    if(!rememberMe)return configured;
    const remembered=Number(process.env.REMEMBER_ME_SESSION_LIFETIME_SECONDS??2592000);
    if(!Number.isInteger(remembered)||remembered<configured||remembered>2592000)throw new Error("REMEMBER_ME_SESSION_LIFETIME_SECONDS must be between the base password lifetime and 2592000");
    return remembered;
  }
  private corporateLifetimeSeconds():number{
    const raw=process.env.AIMS_SESSION_LIFETIME_SECONDS;
    if((aimsEnvironment()==="production"||aimsEnvironment()==="staging")&&!raw)throw new Error("AIMS_SESSION_LIFETIME_SECONDS is required for corporate authentication");
    const configured=Number(raw??28800);
    if(!Number.isInteger(configured)||configured<300||configured>86400)throw new Error("AIMS_SESSION_LIFETIME_SECONDS must be between 300 and 86400");
    return configured;
  }
  private async createSession(identity:SessionIdentity[],method:"LOCAL_ADAPTER"|"CORPORATE_PROVIDER",request:Request,response:Response,client?:PoolClient):Promise<Principal>{
    const issued=await this.insertSession(identity,method,client??this.database.pool);
    this.setCookies(response,issued.token,issued.csrf,issued.lifetime);
    return issued.principal;
  }
  private async insertSession(identity:SessionIdentity[],method:"LOCAL_ADAPTER"|"CORPORATE_PROVIDER"|"LOCAL_PASSWORD",client:Pick<PoolClient,"query">,rememberMe=false):Promise<IssuedCorporateSession>{
    const token=randomBytes(32).toString("base64url"),csrf=randomBytes(24).toString("base64url");
    const lifetime=method==="CORPORATE_PROVIDER"?this.corporateLifetimeSeconds():method==="LOCAL_PASSWORD"?this.passwordLifetimeSeconds(rememberMe):this.localLifetimeSeconds(),sessionId=randomUUID(),row=identity[0];
    await client.query(`INSERT INTO aims_sessions
      (id,token_hash,csrf_token_hash,user_id,external_identity_id,authentication_method,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,now()+($7::text||' seconds')::interval)`,
      [sessionId,this.hash(token),this.hash(csrf),row.user_id,row.identity_id,method,String(lifetime)]);
    return{principal:{id:row.user_id,departmentId:row.department_id,roles:identity.flatMap(value=>value.role?[value.role]:[])},token,csrf,lifetime};
  }
  private setCookies(response:Response,token:string,csrf:string,maxAgeSeconds:number){
    const common={...loadRuntimeFoundationConfig().cookie,maxAge:maxAgeSeconds*1000};
    response.cookie(SESSION_COOKIE,token,{...common,httpOnly:true});
    response.cookie(CSRF_COOKIE,csrf,{...common,httpOnly:false});
  }
  private clearCookies(response:Response){const options=loadRuntimeFoundationConfig().cookie;response.clearCookie(SESSION_COOKIE,{...options,httpOnly:true});response.clearCookie(CSRF_COOKIE,{...options,httpOnly:false});}
  private cookies(request:Request):Record<string,string>{return Object.fromEntries((request.headers.cookie??"").split(";").map(value=>value.trim().split("=")).filter(parts=>parts.length===2).map(([key,value])=>[key,decodeURIComponent(value)]));}
  private hash(value:string){return createHash("sha256").update(value).digest("hex");}
  private equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
  requireAllowedOrigin(request:Request){const allowed=process.env.WEB_ORIGIN??"http://localhost:3000";const origin=request.header("origin");if(origin!==allowed){metrics.counter("aims_domain_operations_total",{operation:"CSRF_ORIGIN",outcome:"FAILURE",failure_category:"AUTHENTICATION",channel:"WEB"});throw new UnauthorizedException("Request origin is not allowed")}}
  private async audit(eventType:string,request:Request,userId:string|null,identityId:string|null,roles:readonly Role[]|null){
    await this.database.pool.query(`INSERT INTO authentication_audit_events
      (id,user_id,external_identity_id,authentication_method,source_channel,event_type,correlation_id,source_ip,actor_role_snapshot)
      VALUES($1,$2,$3,'LOCAL_ADAPTER','WEB',$4,$5,$6,$7)`,[randomUUID(),userId,identityId,eventType,(request as Request&{correlationId?:string}).correlationId??"unavailable",request.ip??null,roles]);
  }
}
