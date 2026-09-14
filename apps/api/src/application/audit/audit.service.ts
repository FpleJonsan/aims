import { Injectable } from "@nestjs/common";
import { Postgres } from "../../infrastructure/database/postgres.js";
import type { AuditQueryDto } from "./audit.dto.js";

const blockedKey=/(password|token|secret|credential|authorization|cookie|api.?key)/i;
function safe(value:unknown):unknown{
  if(Array.isArray(value))return value.slice(0,100).map(safe);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([key])=>!blockedKey.test(key)).map(([key,item])=>[key,safe(item)]));
  return typeof value==="string"&&value.length>1000?`${value.slice(0,1000)}…`:value;
}

@Injectable()
export class AuditService{
  constructor(private readonly db:Postgres){}
  async list(input:AuditQueryDto){
    const page=Math.max(1,Number(input.page??1)),pageSize=Math.min(100,Math.max(1,Number(input.pageSize??25)));
    const result=await this.db.pool.query<Record<string,unknown>&{total:string}>(`SELECT ae.id,ae.actor_id,ae.actor_display_name_snapshot,ae.actor_role_snapshot,ae.occurred_at,ae.action,ae.entity_type,ae.entity_id,ae.source_ip,ae.previous_state,ae.new_state,ae.safe_metadata,count(*) OVER() total
      FROM audit_events ae WHERE($1::timestamptz IS NULL OR ae.occurred_at>=$1)AND($2::timestamptz IS NULL OR ae.occurred_at<=$2)AND($3::uuid IS NULL OR ae.actor_id=$3)AND($4::text IS NULL OR $4=ANY(ae.actor_role_snapshot))AND($5::text IS NULL OR ae.action=$5)AND($6::text IS NULL OR ae.entity_type=$6)AND($7::uuid IS NULL OR ae.entity_id=$7)
      ORDER BY ae.occurred_at DESC,ae.id DESC LIMIT $8 OFFSET $9`,[input.dateFrom??null,input.dateTo??null,input.actorId??null,input.role??null,input.action??null,input.entityType??null,input.entityId??null,pageSize,(page-1)*pageSize]);
    const total=result.rows[0]?Number(result.rows[0].total):0;
    return{items:result.rows.map(({total:rowTotal,safe_metadata,...row})=>{void rowTotal;return{...row,metadata:safe(safe_metadata)}}),page,pageSize,total,totalPages:Math.max(1,Math.ceil(total/pageSize))};
  }
}
