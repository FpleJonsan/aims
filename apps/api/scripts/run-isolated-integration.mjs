import {randomBytes} from "node:crypto";
import {chmod,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {assertDisposableIntegrationDatabase} from "./integration-database-guard.mjs";

const root=path.resolve(import.meta.dirname,"../../..");
const apiRoot=path.join(root,"apps/api");
const requested=process.argv.slice(2);
if(requested.length===0||requested.some(value=>!/^\.test-dist\/test\/[a-z0-9-]+\.test\.js$/.test(value))) throw new Error("one or more compiled integration test files are required");
const suffix=`${process.pid}_${randomBytes(6).toString("hex")}`;
const container=`aims-integration-${suffix.replaceAll("_","-")}`;
const database=`aims_test_${suffix}`;
const password=()=>`T_${randomBytes(24).toString("base64url")}`;
const credentials={admin:password(),app:password(),finance:password(),payment:password(),migrator:password()};
const envFile=path.join(tmpdir(),`${container}.env`);

function run(command,args,{input,env=process.env,quiet=false,cwd=root}={}){
  const result=spawnSync(command,args,{cwd,input,env,encoding:"utf8",maxBuffer:30*1024*1024});
  if(result.status!==0){
    const safe=(result.stderr||result.stdout||"command failed").replaceAll(/postgres(?:ql)?:\/\/[^\s]+/g,"[REDACTED_DATABASE_URL]");
    throw new Error(`${command} failed: ${safe.trim()}`);
  }
  if(!quiet&&result.stdout)process.stdout.write(result.stdout);
  return result.stdout;
}
function adminPsql(sql){return run("docker",["exec","-i",container,"sh","-lc",`PGPASSWORD="$POSTGRESQL_PASSWORD" psql -X -v ON_ERROR_STOP=1 -U postgres -d ${database}`],{input:sql,quiet:true});}
function postgresPsql(sql){return run("docker",["exec","-i",container,"sh","-lc",'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres'],{input:sql,quiet:true});}
async function waitReady(){for(let i=0;i<60;i+=1){if(spawnSync("docker",["exec",container,"pg_isready","-U","postgres","-d",database],{encoding:"utf8"}).status===0)return;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error("disposable integration PostgreSQL did not become ready");}
const literal=value=>`'${value.replaceAll("'","''")}'`;

try{
  await writeFile(envFile,`POSTGRESQL_PASSWORD=${credentials.admin}\nPOSTGRESQL_DATABASE=${database}\n`,{mode:0o600});await chmod(envFile,0o600);
  run("docker",["run","-d","--rm","--name",container,"--env-file",envFile,"-p","127.0.0.1::5432","bitnami/postgresql:latest"],{quiet:true});
  await waitReady();
  await new Promise(resolve=>setTimeout(resolve,2000));
  await waitReady();
  postgresPsql(`SELECT 'CREATE DATABASE ${database}' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='${database}')\\gexec\n`);
  const bootstrap=(await readFile(path.join(apiRoot,"database/production/bootstrap-roles.sql"),"utf8")).replaceAll(':"DBNAME"',`"${database}"`);
  adminPsql(bootstrap);
  adminPsql(`ALTER ROLE aims_migrator PASSWORD ${literal(credentials.migrator)};ALTER ROLE aims_app PASSWORD ${literal(credentials.app)};ALTER ROLE aims_finance_runtime PASSWORD ${literal(credentials.finance)};ALTER ROLE aims_payment_runtime PASSWORD ${literal(credentials.payment)};`);
  const migrations=(await readdir(path.join(apiRoot,"migrations"))).filter(name=>/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<=56).sort();
  if(migrations.length!==56||!migrations[0].startsWith("001_")||!migrations.at(-1).startsWith("056_"))throw new Error("expected immutable migration chain 001-056");
  for(const name of migrations)adminPsql(`SET ROLE aims_owner;\n${await readFile(path.join(apiRoot,"migrations",name),"utf8")}`);
  adminPsql(await readFile(path.join(apiRoot,"database/production/post-migration-hardening.sql"),"utf8"));
  adminPsql(await readFile(path.join(apiRoot,"database/production/privilege-manifest.sql"),"utf8"));
  const port=run("docker",["port",container,"5432/tcp"],{quiet:true}).trim().split(":").at(-1);
  const url=(user,secret)=>`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(secret)}@127.0.0.1:${port}/${database}`;
  const urls=[url("aims_app",credentials.app),url("aims_finance_runtime",credentials.finance),url("aims_payment_runtime",credentials.payment)];
  assertDisposableIntegrationDatabase({databaseName:database,urls});
  run("npx",["tsc","-p","tsconfig.test.json"],{cwd:apiRoot});
  const env={...process.env,AIMS_ENVIRONMENT:"local",DATABASE_URL:urls[0],FINANCE_DATABASE_URL:urls[1],PAYMENT_DATABASE_URL:urls[2],AIMS_INTEGRATION_DATABASE:database,AIMS_INTEGRATION_DISPOSABLE:"true"};
  run(process.execPath,["--env-file=../../.env","--test","--test-concurrency=1",...requested],{cwd:apiRoot,env});
  console.log(JSON.stringify({result:"PASS",database:"isolated-disposable",schema:56,tests:requested.length,cleanup:"pending"}));
}finally{
  spawnSync("docker",["rm","-f",container],{encoding:"utf8"});
  await rm(envFile,{force:true});
}
