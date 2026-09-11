#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2]??'bootstrap';
if(!['bootstrap','migrate','seed'].includes(mode))throw new Error('Use bootstrap, migrate, or seed');
function compose(args,input){const result=spawnSync('docker',['compose','-f',path.join(root,'docker-compose.yml'),...args],{cwd:root,input,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr||'Docker Compose command failed');return result.stdout.trim()}
function sql(input,database='aims'){return compose(['exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-At','-U','postgres','-d',database],input)}
let ready=false;
for(let i=0;i<60;i++){try{sql('SELECT 1','postgres');ready=true;break}catch{await new Promise(resolve=>setTimeout(resolve,1000))}}
if(!ready)throw new Error('PostgreSQL unavailable. Run docker compose up -d first.');
const envPath=path.join(root,'.env.local');
if(mode==='bootstrap'){
 const present=sql("SELECT 1 FROM pg_database WHERE datname='aims'",'postgres');
 if(!present)sql('CREATE DATABASE aims','postgres');
 const initialized=sql("SELECT count(*) FROM pg_roles WHERE rolname='aims_document_worker_runtime'")==='1';
 if(!initialized){
  let bootstrap='BEGIN;\n'+readFileSync(path.join(root,'apps/api/database/production/bootstrap-roles.sql'),'utf8').replaceAll(':"DBNAME"','"aims"');
  for(const [role,password] of Object.entries({aims_migrator:'local_migrator',aims_app:'local_app',aims_finance_runtime:'local_finance',aims_payment_runtime:'local_payment',aims_document_worker_runtime:'local_worker'}))bootstrap+=`\nALTER ROLE ${role} PASSWORD '${password}';`;
  sql(bootstrap+'\nCOMMIT;');
 }
 if(!existsSync(envPath)){
  let env=readFileSync(path.join(root,'.env.example'),'utf8');
  const port=process.env.AIMS_LOCAL_POSTGRES_PORT??'55432';
  const values={DATABASE_URL:`postgresql://aims_app:local_app@127.0.0.1:${port}/aims`,FINANCE_DATABASE_URL:`postgresql://aims_finance_runtime:local_finance@127.0.0.1:${port}/aims`,PAYMENT_DATABASE_URL:`postgresql://aims_payment_runtime:local_payment@127.0.0.1:${port}/aims`,DOCUMENT_WORKER_DATABASE_URL:`postgresql://aims_document_worker_runtime:local_worker@127.0.0.1:${port}/aims`,REDIS_URL:`redis://127.0.0.1:${process.env.AIMS_LOCAL_REDIS_PORT??'56379'}/15`};
  for(const [key,value] of Object.entries(values))env=env.replace(new RegExp(`^${key}=.*$`,'m'),`${key}=${value}`);
  writeFileSync(envPath,env,{mode:0o600,flag:'wx'});
 }
 console.log('Local bootstrap ready; existing .env.local preserved. Next: node scripts/local-bootstrap.mjs migrate');
}else if(mode==='migrate'){
 const versionTable=sql("SELECT to_regclass('public.aims_schema_version') IS NOT NULL")==='t';
 const version=versionTable?sql('SELECT version FROM aims_schema_version WHERE singleton'):'0';
 if(version!=='61'){
  if(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")!=='0')throw new Error('Database is not empty or at schema 61. Refusing to replay migrations over partial initialization. Preserve and inspect it before retrying.');
  const directory=path.join(root,'apps/api/migrations');
  const names=readdirSync(directory).filter(n=>/^\d{3}_.*\.sql$/.test(n)).sort();
  if(names.length!==61||!names.at(-1).startsWith('061_'))throw new Error('Expected frozen migrations 001–061');
  for(const name of names){sql('SET ROLE aims_owner;\n'+readFileSync(path.join(directory,name),'utf8'));console.log(`Applied ${name}`)}
 }
 sql(readFileSync(path.join(root,'apps/api/database/production/post-migration-hardening.sql'),'utf8'));
 sql(readFileSync(path.join(root,'apps/api/database/production/privilege-manifest.sql'),'utf8'));
 console.log('Schema 61 ready; existing P6 role separation verified.');
}else{
 if(sql('SELECT version FROM aims_schema_version WHERE singleton')!=='61')throw new Error('Migrate first');
 const users=Number(sql('SELECT count(*) FROM users'));
 if(users===0)throw new Error('Expected synthetic seed identities from immutable migrations');
 console.log(`Synthetic seeds already applied by migrations; ${users} users present. No duplicate seed writes.`);
}
