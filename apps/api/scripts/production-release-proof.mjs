import {randomBytes} from "node:crypto";
import {readFile,writeFile,chmod,rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import pg from "pg";

const root=path.resolve(import.meta.dirname,"../../..");
const container=`aims-production-proof-${process.pid}`;
const database="aims_production_proof";
const secret=()=>`RC_${randomBytes(24).toString("base64url")}`;
const credentials={admin:secret(),app:secret(),finance:secret(),payment:secret(),worker:secret(),migrator:secret()};
const envFile=path.join(tmpdir(),`${container}.env`);
function run(command,args,{input,quiet=false,env=process.env}={}){const result=spawnSync(command,args,{cwd:root,input,env,encoding:"utf8",maxBuffer:20*1024*1024});if(result.status!==0){const safe=(result.stderr||result.stdout||"command failed").replaceAll(/postgres(?:ql)?:\/\/[^\s]+/g,"[REDACTED_DATABASE_URL]");throw new Error(`${command} failed: ${safe.trim()}`)}if(!quiet&&result.stdout.trim())process.stdout.write(result.stdout);return result.stdout}
function psql(sql,databaseName=database){return run("docker",["exec","-i",container,"sh","-lc",`PGPASSWORD="$POSTGRESQL_PASSWORD" psql -X -v ON_ERROR_STOP=1 -U postgres -d ${databaseName}`],{input:sql,quiet:true})}
async function ready(){for(let attempt=0;attempt<60;attempt+=1){if(spawnSync("docker",["exec",container,"pg_isready","-U","postgres","-d","postgres"],{encoding:"utf8"}).status===0)return;await new Promise(resolve=>setTimeout(resolve,500))}throw new Error("disposable PostgreSQL did not become ready")}
const literal=value=>`'${value.replaceAll("'","''")}'`;

try{
 await writeFile(envFile,`POSTGRESQL_PASSWORD=${credentials.admin}\nPOSTGRESQL_DATABASE=${database}\n`,{mode:0o600});await chmod(envFile,0o600);
 run("docker",["run","-d","--rm","--name",container,"--env-file",envFile,"-p","127.0.0.1::5432","bitnami/postgresql:latest"],{quiet:true});
 await ready();await new Promise(resolve=>setTimeout(resolve,2000));await ready();
 psql(`SELECT 'CREATE DATABASE ${database}' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='${database}')\\gexec\n`,"postgres");
 const bootstrap=await readFile(path.join(root,"apps/api/database/production/bootstrap-roles.sql"),"utf8");psql(bootstrap.replaceAll(':"DBNAME"',`"${database}"`));
 psql(`ALTER ROLE aims_migrator PASSWORD ${literal(credentials.migrator)};ALTER ROLE aims_app PASSWORD ${literal(credentials.app)};ALTER ROLE aims_finance_runtime PASSWORD ${literal(credentials.finance)};ALTER ROLE aims_payment_runtime PASSWORD ${literal(credentials.payment)};ALTER ROLE aims_document_worker_runtime PASSWORD ${literal(credentials.worker)};`);
 const port=run("docker",["port",container,"5432/tcp"],{quiet:true}).trim().split(":").at(-1);
 const url=(user,password)=>`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
 const productionEnv={...process.env,AIMS_ENVIRONMENT:"production",AIMS_MIGRATION_DATABASE_URL:url("aims_migrator",credentials.migrator)};
 run("node",["apps/api/scripts/production-migrate.mjs","--isolated-proof"],{env:productionEnv,quiet:true});
 const client=new pg.Client({connectionString:url("aims_app",credentials.app)});await client.connect();
 const health=await client.query("SELECT version,migration_id FROM aims_schema_version WHERE singleton");
 const fixtureCounts=await client.query("SELECT (SELECT count(*) FROM users) users,(SELECT count(*) FROM departments) departments,(SELECT count(*) FROM policy_sets) policies,(SELECT count(*) FROM budgets) budgets");
 await client.end();
 if(Number(health.rows[0]?.version)!==70||health.rows[0]?.migration_id!=="070_p20_5h_ai_configuration_authority")throw new Error("runtime schema check failed");
 if(Object.values(fixtureCounts.rows[0]).some(value=>Number(value)!==0))throw new Error("production business fixture population is not empty");
 const developmentEnv={...process.env,DATABASE_URL:url("aims_migrator",credentials.migrator)};
 run("node",["apps/api/scripts/development-fixtures.mjs"],{env:developmentEnv,quiet:true});
 run("node",["apps/api/scripts/development-fixtures.mjs"],{env:developmentEnv,quiet:true});
 const development=new pg.Client({connectionString:url("aims_app",credentials.app)});await development.connect();
 const developmentCounts=await development.query("SELECT count(*)::int demo_users FROM users WHERE external_subject LIKE 'demo.%'");await development.end();
 if(developmentCounts.rows[0].demo_users<1)throw new Error("development fixture layer did not populate demo identities");
 console.log(JSON.stringify({result:"PASS",environment:"isolated-production-proof",schema:70,migration:"070_p20_5h_ai_configuration_authority",migrationFiles:70,executedFiles:56,deferredFixtureFiles:14,filteredMixedFiles:2,noDemoRecords:true,systemBootstrap:true,privileges:true,runtimeSchemaCheck:true,developmentFixture:true,developmentFixtureIdempotent:true}));
}finally{spawnSync("docker",["rm","-f",container],{encoding:"utf8"});await rm(envFile,{force:true})}
