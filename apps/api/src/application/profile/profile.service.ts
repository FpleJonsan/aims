import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Principal } from "../../domain/payment-request.js";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { UpdateProfileDto } from "./profile.dto.js";

@Injectable()
export class ProfileService {
  constructor(private readonly db: Postgres) {}

  async get(actor: Principal) {
    const result = await this.db.pool.query<{id:string;email:string;display_name:string;department:string;language:string;last_login_at:string|null}>(
      `SELECT u.id,u.email,u.display_name,d.name department,u.language,u.last_login_at
       FROM users u JOIN departments d ON d.id=u.department_id WHERE u.id=$1 AND u.active`, [actor.id]);
    if (!result.rowCount) throw new ForbiddenException("Active identity required");
    const row=result.rows[0];
    return {id:row.id,email:row.email,displayName:row.display_name,department:row.department,language:row.language,lastLoginAt:row.last_login_at,avatar:null};
  }

  async update(actor: Principal, input: UpdateProfileDto, request: Request) {
    const displayName=input.displayName.trim();
    if (!displayName) throw new BadRequestException("Display name is required");
    await this.db.transaction(async client => {
      const previous=await client.query<{display_name:string;language:string}>(`SELECT display_name,language FROM users WHERE id=$1 AND active FOR UPDATE`,[actor.id]);
      if(!previous.rowCount)throw new NotFoundException("Profile not found");
      await client.query(`UPDATE users SET display_name=$2,language=$3 WHERE id=$1`,[actor.id,displayName,input.language]);
      await client.query(`INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,correlation_id,safe_metadata,source_ip,actor_role_snapshot,actor_display_name_snapshot)
        VALUES($1,$2,'PROFILE_UPDATED','USER_PROFILE',$2,$3,$4,$5,$6,$7)`,[randomUUID(),actor.id,request.correlationId??"unavailable",JSON.stringify({changedFields:[...(previous.rows[0].display_name!==displayName?["displayName"]:[]),...(previous.rows[0].language!==input.language?["language"]:[])]}),request.ip??null,actor.roles,displayName]);
    });
    return this.get(actor);
  }
}
