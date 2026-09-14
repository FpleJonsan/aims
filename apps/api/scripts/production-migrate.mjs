import {readFile,readdir} from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {PRODUCTION_FIXTURE_ASSERTION_SQL,productionMigrationSql,validateMigrationNames} from "./production-migration-plan.mjs";

const root=path.resolve(import.meta.dirname,"../../..");
const connectionString=process.env.AIMS_MIGRATION_DATABASE_URL;
if(!connectionString)throw new Error("AIMS_MIGRATION_DATABASE_URL is required");
if(process.env.AIMS_ENVIRONMENT!=="production"&&!process.argv.includes("--isolated-proof"))throw new Error("production migration requires AIMS_ENVIRONMENT=production");
const parsed=new URL(connectionString);
if(decodeURIComponent(parsed.username)!=="aims_migrator")throw new Error("production migration requires the dedicated aims_migrator login");
if(["postgres","template0","template1","aims","aims_competition"].includes(parsed.pathname.slice(1)))throw new Error("production migration target database is not safely isolated");
if(["localhost","127.0.0.1","::1"].includes(parsed.hostname)&&!process.argv.includes("--isolated-proof"))throw new Error("production migration rejects loopback targets");

const client=new pg.Client({connectionString});
const serverSql=source=>source.split("\n").filter(line=>!line.startsWith("\\")).join("\n");
await client.connect();
try{
 const existing=await client.query("SELECT count(*)::int count FROM pg_tables WHERE schemaname='public'");
 if(existing.rows[0].count!==0)throw new Error("production migration requires a fresh empty database");
 const directory=path.join(root,"apps/api/migrations");
 const names=(await readdir(directory)).filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();validateMigrationNames(names);
 let executed=0,deferred=0,filtered=0;
 for(const name of names){
  const source=await readFile(path.join(directory,name),"utf8"),migration=productionMigrationSql(name,source);
  if(!migration){deferred+=1;continue}
  if(migration!==source)filtered+=1;
  await client.query(`SET ROLE aims_owner;\n${migration}`);executed+=1;
 }
 await client.query(serverSql(await readFile(path.join(root,"apps/api/database/production/post-migration-hardening.sql"),"utf8")));
 await client.query(serverSql(await readFile(path.join(root,"apps/api/database/production/privilege-manifest.sql"),"utf8")));
 await client.query(`SET ROLE aims_owner;${PRODUCTION_FIXTURE_ASSERTION_SQL}`);
 console.log(JSON.stringify({result:"PASS",schema:71,migration:"071_p20_7a_enterprise_ui_contracts",migrationFiles:71,executedFiles:executed,deferredFixtureFiles:deferred,filteredMixedFiles:filtered,noDemoRecords:true}));
}finally{await client.end()}
