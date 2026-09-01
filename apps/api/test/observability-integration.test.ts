import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error("isolated application database URL is required");
const pool=new pg.Pool({connectionString:databaseUrl});

function planText(value:unknown){return JSON.stringify(value)}
function rootPlan(row:Record<string,unknown>){return ((row["QUERY PLAN"] as Array<{Plan:Record<string,unknown>}>)[0]).Plan}
function nodes(plan:Record<string,unknown>):Record<string,unknown>[] {return [plan,...((plan.Plans as Record<string,unknown>[]|undefined)??[]).flatMap(nodes)]}

test("Telegram backlog plans exclude historical SENT rows and use status indexes",async()=>{
  await pool.query("BEGIN");
  try{
    await pool.query(`INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,payload,status,created_at)
      SELECT gen_random_uuid(),'P10_PLAN',gen_random_uuid(),'PLAN','TELEGRAM','{}'::jsonb,'SENT',now()-interval '30 days'
      FROM generate_series(1,20000)`);
    await pool.query(`INSERT INTO notification_outbox(id,aggregate_type,aggregate_id,event_type,channel,payload,status,created_at)
      SELECT gen_random_uuid(),'P10_PLAN',gen_random_uuid(),'PLAN','TELEGRAM','{}'::jsonb,status,now()-interval '5 minutes'
      FROM unnest(ARRAY['PENDING','FAILED_RETRYABLE','PROCESSING','FAILED_TERMINAL']) status`);
    await pool.query("ANALYZE notification_outbox");
    const active=await pool.query(`EXPLAIN (ANALYZE,FORMAT JSON) SELECT count(*)FILTER(WHERE status='PENDING')::int pending,count(*)FILTER(WHERE status='FAILED_RETRYABLE')::int retrying,count(*)FILTER(WHERE status='PROCESSING')::int claimed,COALESCE(extract(epoch FROM now()-min(created_at)FILTER(WHERE status IN('PENDING','FAILED_RETRYABLE'))),0)::bigint oldest FROM notification_outbox WHERE status IN('PENDING','FAILED_RETRYABLE','PROCESSING')`);
    const terminal=await pool.query(`EXPLAIN (ANALYZE,FORMAT JSON) SELECT count(*)::int terminal FROM notification_outbox WHERE status='FAILED_TERMINAL'`);
    const activePlan=planText(active.rows[0]["QUERY PLAN"]),terminalPlan=planText(terminal.rows[0]["QUERY PLAN"]);
    assert.doesNotMatch(activePlan,/"Relation Name":"notification_outbox"[^}]*"Node Type":"Seq Scan"/);
    assert.match(activePlan,/notification_outbox_claimable_idx/);
    assert.doesNotMatch(terminalPlan,/"Relation Name":"notification_outbox"[^}]*"Node Type":"Seq Scan"/);
    assert.match(terminalPlan,/notification_outbox_failed_terminal_idx/);
    const evidence=(result:typeof active)=>nodes(rootPlan(result.rows[0])).filter(node=>node["Relation Name"]==="notification_outbox").map(node=>({nodeType:node["Node Type"],indexName:node["Index Name"],planRows:node["Plan Rows"],actualRows:node["Actual Rows"],totalCost:node["Total Cost"],rowsRemoved:node["Rows Removed by Filter"]??0}));
    console.log(JSON.stringify({p10BacklogPlan:{syntheticRows:20004,historicalSentRows:20000,active:evidence(active),terminal:evidence(terminal)}}));
  }finally{await pool.query("ROLLBACK")}
});

test.after(async()=>pool.end());
