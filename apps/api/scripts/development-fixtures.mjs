import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {DEVELOPMENT_FIXTURE_MIGRATIONS,PRODUCTION_MIGRATION_ID,PRODUCTION_SCHEMA_VERSION,developmentFixtureSql} from "./production-migration-plan.mjs";

const root=path.resolve(import.meta.dirname,"../../..");
const url=process.env.DATABASE_URL;
if(!url)throw new Error("DATABASE_URL is required");
const parsed=new URL(url);
if(!["localhost","127.0.0.1","::1"].includes(parsed.hostname))throw new Error("development fixtures require a loopback database");
if(parsed.username!=="aims_migrator")throw new Error("development fixtures require the dedicated aims_migrator login");
const client=new pg.Client({connectionString:url});
await client.connect();
try{
 await client.query("SET ROLE aims_owner");
 const schema=(await client.query("SELECT version,migration_id FROM aims_schema_version WHERE singleton")).rows[0];
 if(Number(schema?.version)!==PRODUCTION_SCHEMA_VERSION||schema?.migration_id!==PRODUCTION_MIGRATION_ID)throw new Error("development fixtures require schema 69");
 const existing=Number((await client.query("SELECT count(*) count FROM users WHERE external_subject LIKE 'demo.%'")).rows[0].count);
 if(existing>0)console.log(JSON.stringify({result:"PASS",layer:"development-fixtures",existing:true,demoUsers:existing}));
 else{
  const names=(await readdir(path.join(root,"apps/api/migrations"))).filter(name=>DEVELOPMENT_FIXTURE_MIGRATIONS.has(name)).sort();
  for(const name of names){const source=await readFile(path.join(root,"apps/api/migrations",name),"utf8");await client.query(developmentFixtureSql(name,source))}
  await client.query(`INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
   SELECT gen_random_uuid(),id,'local','aims-local',external_subject FROM users WHERE external_subject LIKE 'demo.%'
   ON CONFLICT (issuer,subject) DO NOTHING`);
  console.log(JSON.stringify({result:"PASS",layer:"development-fixtures",files:names.length}));
 }
}finally{await client.end()}
