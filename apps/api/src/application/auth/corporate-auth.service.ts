import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { PoolClient } from "pg";
import { Postgres } from "../../infrastructure/database/postgres.js";
import { metrics } from "../../infrastructure/observability/telemetry.js";
import {
  CORPORATE_IDENTITY_PROVIDER,
  type CorporateIdentityProvider,
} from "./corporate-identity.provider.js";
import { SessionService } from "./session.service.js";

type TransactionRow = {
  pkce_verifier: string;
  nonce_digest: string;
  return_path: string;
  provider_adapter: string;
  expected_issuer: string;
};

@Injectable()
export class CorporateAuthService {
  constructor(
    private readonly database: Postgres,
    private readonly sessions: SessionService,
    @Inject(CORPORATE_IDENTITY_PROVIDER) private readonly provider: CorporateIdentityProvider,
  ) {}

  async initiate(returnPath: string | undefined, request: Request): Promise<{ authorizationUrl: string }> {
    this.requireProvider();
    const destination = validateReturnPath(returnPath ?? "/");
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const correlationId = this.correlationId(request);
    await this.database.pool.query(
      `SELECT * FROM create_corporate_auth_transaction($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), digest(state), verifier, digest(nonce), destination, this.provider.adapterId,
        this.provider.expectedIssuer, 300, correlationId],
    );
    const authorization = this.provider.buildAuthorizationRequest({ state, pkceChallenge: challenge, nonce });
    assertTrustedAuthorizationUrl(authorization.authorizationUrl,this.provider.authorizationEndpoint);
    await this.audit("CORPORATE_LOGIN_INITIATED", request, null, null);
    metrics.counter("aims_domain_operations_total", { operation: "CORPORATE_LOGIN", outcome: "INITIATED", failure_category: "NONE", channel: "WEB" });
    return authorization;
  }

  async callback(state: string | undefined, code: string | undefined, request: Request, response: Response): Promise<string> {
    this.requireProvider();
    if (!boundedOpaque(state, 43, 512) || !boundedAuthorizationCode(code)) return this.deny("CORPORATE_TRANSACTION_INVALID", request);
    let denied:string|undefined,destination="/",generation="",savedTransaction:TransactionRow|undefined;
    await this.database.transaction(async(client)=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const current=await client.query<{generation:string}>("SELECT generation::text generation FROM aims_recovery_generation WHERE singleton");generation=current.rows[0]?.generation??"";
      const transaction=await client.query<TransactionRow>(`SELECT * FROM consume_corporate_auth_transaction($1)`,[digest(state!)]);
      if(transaction.rowCount!==1){denied="CORPORATE_TRANSACTION_INVALID";return}
      const saved=transaction.rows[0];destination=saved.return_path;
      if(saved.provider_adapter!==this.provider.adapterId||saved.expected_issuer!==this.provider.expectedIssuer){denied="CORPORATE_PROVIDER_MISMATCH";return}
      savedTransaction=saved;
    });
    if(denied)return this.deny(denied,request);
    const saved=savedTransaction!;
    let verified;
    try{verified=await this.provider.exchangeAndVerify({code:code!,pkceVerifier:saved.pkce_verifier,expectedIssuer:saved.expected_issuer,expectedNonceDigest:saved.nonce_digest})}
    catch{return this.deny("CORPORATE_PROVIDER_VERIFICATION_FAILED",request)}
    if(!boundedIdentity(verified.issuer,255)||!boundedIdentity(verified.subject,255)||verified.issuer!==saved.expected_issuer)return this.deny("CORPORATE_PROVIDER_VERIFICATION_FAILED",request);
    let issued:import("./session.service.js").IssuedCorporateSession|undefined;
    await this.database.transaction(async(client)=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtext('aims:recovery-generation'))");
      const current=await client.query<{generation:string}>("SELECT generation::text generation FROM aims_recovery_generation WHERE singleton");
      if(current.rows[0]?.generation!==generation){denied="CORPORATE_RECOVERY_GENERATION_CHANGED";return}
      const identity=await client.query<{identity_id:string;user_id:string;department_id:string;role:import("../../domain/payment-request.js").Role|null}>(`
        SELECT x.id identity_id,u.id user_id,u.department_id,ur.role FROM user_external_identities x
        JOIN users u ON u.id=x.user_id AND u.active=true LEFT JOIN user_roles ur ON ur.user_id=u.id
        WHERE x.provider=$1 AND x.issuer=$2 AND x.subject=$3`,[this.provider.adapterId,verified.issuer,verified.subject]);
      if(!identity.rowCount){denied="CORPORATE_IDENTITY_UNKNOWN_OR_INACTIVE";return}
      issued=await this.sessions.createCorporateSessionRecord(identity.rows,client);
      await this.audit("CORPORATE_LOGIN_SUCCEEDED",request,identity.rows[0].user_id,identity.rows[0].identity_id,client);
    });
    if(denied)return this.deny(denied,request);
    this.sessions.setCorporateSessionCookies(response,issued!);
    metrics.counter("aims_domain_operations_total", { operation: "CORPORATE_LOGIN", outcome: "SUCCESS", failure_category: "NONE", channel: "WEB" });
    return validateReturnPath(destination);
  }

  private requireProvider(): void {
    if (!this.provider.available) throw new UnauthorizedException("Corporate authentication is not configured");
  }
  private correlationId(request: Request): string {
    const value=(request as Request&{correlationId?:string}).correlationId;
    return value && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(value) ? value : randomUUID();
  }
  private async deny(event: string, request: Request): Promise<never> {
    await this.audit(event, request, null, null);
    metrics.counter("aims_domain_operations_total", { operation: "CORPORATE_LOGIN", outcome: "FAILURE", failure_category: "AUTHENTICATION", channel: "WEB" });
    throw new UnauthorizedException("Corporate authentication failed");
  }
  private async audit(eventType:string,request:Request,userId:string|null,identityId:string|null,client?:PoolClient):Promise<void>{
    await (client??this.database.pool).query(`INSERT INTO authentication_audit_events
      (id,user_id,external_identity_id,authentication_method,source_channel,event_type,correlation_id)
      VALUES($1,$2,$3,'CORPORATE_PROVIDER','WEB',$4,$5)`,
      [randomUUID(),userId,identityId,eventType,this.correlationId(request)]);
  }
}

export function validateReturnPath(value:string):string {
  if(value.length>512||(!/^\/(?!\/)[A-Za-z0-9/_?&=.%+~-]*$/.test(value))||/%(?:2f|5c|3a)/i.test(value))
    throw new UnauthorizedException("Invalid return path");
  try { const decoded=decodeURIComponent(value); if(decoded.startsWith("//")||decoded.includes("\\")||/^[a-z][a-z0-9+.-]*:/i.test(decoded.slice(1))) throw new Error(); }
  catch { throw new UnauthorizedException("Invalid return path"); }
  return value;
}
function digest(value:string):string{return createHash("sha256").update(value).digest("hex")}
function boundedOpaque(value:string|undefined,min:number,max:number):boolean{return Boolean(value&&value.length>=min&&value.length<=max&&/^[A-Za-z0-9._~-]+$/.test(value))}
function boundedAuthorizationCode(value:string|undefined):boolean{return Boolean(value&&value.length<=2048&&/^[!-~]+$/.test(value))}
function boundedIdentity(value:string,max:number):boolean{return value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value)}
function assertTrustedAuthorizationUrl(value:string,trustedEndpoint:string):void{let parsed:URL,trusted:URL;try{parsed=new URL(value);trusted=new URL(trustedEndpoint)}catch{throw new Error("CORPORATE_AUTHORIZATION_URL_INVALID")}if(parsed.protocol!=="https:"||trusted.protocol!=="https:"||parsed.origin!==trusted.origin||parsed.pathname!==trusted.pathname||parsed.username||parsed.password||parsed.hash)throw new Error("CORPORATE_AUTHORIZATION_URL_INVALID")}
