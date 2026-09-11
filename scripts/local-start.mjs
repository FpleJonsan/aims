#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const children=new Set();let stopping=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function stop(code){if(stopping)return;stopping=true;for(const child of children){try{process.kill(-child.pid,'SIGTERM')}catch{}}
 await Promise.race([Promise.all([...children].map(child=>new Promise(resolve=>child.once('exit',resolve)))),delay(16000)]);
 for(const child of children){try{process.kill(-child.pid,'SIGKILL')}catch{}}process.exit(code);
}
process.on('SIGINT',()=>void stop(0));process.on('SIGTERM',()=>void stop(0));
function start(label,command,args,env){console.log(`Starting ${label}...`);const child=spawn(command,args,{cwd:root,env,stdio:'inherit',detached:true});children.add(child);child.once('error',error=>{console.error(`${label}: ${error.message}`);void stop(1)});child.once('exit',(code)=>{children.delete(child);if(!stopping){console.error(`${label} exited (${code}). Stopping local services.`);void stop(1)}});return child}
async function free(port,host){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(new Error(`Port ${port} is occupied. Stop its existing service before running npm run local.`)));server.listen(port,host,()=>server.close(resolve))})}
async function health(url){for(let i=0;i<90&&!stopping;i++){try{const response=await fetch(url,{signal:AbortSignal.timeout(1500)});if(response.ok)return}catch{}await delay(1000)}throw new Error(`Readiness timed out: ${url}`)}
try{
 console.log('Checking environment...');if(!existsSync('.env.local'))throw new Error('Missing .env.local. Run docker compose up -d, then node scripts/local-bootstrap.mjs bootstrap, migrate, and seed.');
 const env={...process.env,...parseEnv(readFileSync('.env.local','utf8'))};
 for(const key of ['DATABASE_URL','FINANCE_DATABASE_URL','PAYMENT_DATABASE_URL','DOCUMENT_WORKER_DATABASE_URL','REDIS_URL'])if(!env[key])throw new Error(`Missing ${key} in .env.local. Complete local bootstrap.`);
 if(!['development','local'].includes(env.AIMS_ENVIRONMENT??'development'))throw new Error('npm run local requires AIMS_ENVIRONMENT=development or local.');
 console.log('Checking PostgreSQL...');const pool=new pg.Pool({connectionString:env.DATABASE_URL,connectionTimeoutMillis:3000});try{const result=await pool.query('SELECT version,migration_id FROM aims_schema_version WHERE singleton');if(result.rows[0]?.version!==61||result.rows[0]?.migration_id!=='061_p13_storage_object_version_binding')throw new Error('Schema 61 required. Run node scripts/local-bootstrap.mjs migrate.')}finally{await pool.end()}
 console.log('Checking Redis...');const redis=new URL(env.REDIS_URL);await new Promise((resolve,reject)=>{const socket=net.createConnection({host:redis.hostname,port:Number(redis.port||6379)});socket.setTimeout(3000);socket.on('connect',()=>socket.write('*1\r\n$4\r\nPING\r\n'));socket.on('data',data=>{socket.destroy();if(data.toString().startsWith('+PONG'))resolve();else reject(new Error('Redis PING failed'))});socket.on('error',reject);socket.on('timeout',()=>{socket.destroy();reject(new Error('Redis unavailable. Run docker compose up -d.'))})});
 const host=env.API_HOST||'127.0.0.1',apiPort=Number(env.API_PORT||3001),workerPort=Number(env.WORKER_HEALTH_PORT||3002),web=new URL(env.WEB_ORIGIN||'http://localhost:3000');
 const browserApi=env.NEXT_PUBLIC_AIMS_API_URL??`http://localhost:${apiPort}`;
 const browserUrl=new URL(browserApi);
 const localHosts=new Set(['localhost','127.0.0.1','[::1]']);
 if(browserUrl.protocol!=='http:'||Number(browserUrl.port||80)!==apiPort||!(browserUrl.hostname===host||(localHosts.has(browserUrl.hostname)&&localHosts.has(host)))||browserUrl.pathname!=='/'||browserUrl.search||browserUrl.hash)throw new Error('NEXT_PUBLIC_AIMS_API_URL must address the launched local API. Correct the explicit override or API_PORT; the override was not changed.');
 env.NEXT_PUBLIC_AIMS_API_URL=browserApi;
 console.log(`Browser API: ${browserApi}`);
 const webPort=Number(web.port||80);await free(apiPort,host);await free(workerPort,'127.0.0.1');await free(webPort,'::');
 console.log('Building API and Worker...');await new Promise((resolve,reject)=>{const child=spawn('npm',['run','build','--workspace','@aims/api'],{env,stdio:'inherit',detached:true});children.add(child);child.once('error',reject);child.once('exit',code=>{children.delete(child);if(code===0)resolve();else reject(new Error('API build failed'))})});
 if(stopping)process.exit(0);
 start('API',process.execPath,['apps/api/dist/src/main.js'],env);
 start('Worker',process.execPath,['apps/api/dist/src/worker-main.js'],env);
 start('Frontend',process.execPath,['node_modules/vinext/dist/cli.js','dev','--port',String(webPort)],env);
 console.log('Waiting for health...');await Promise.all([health(`http://${host}:${apiPort}/health/ready`),health(`http://127.0.0.1:${workerPort}/health/ready`),health(`${web.origin}/login`)]);
 console.log('Checking browser API connectivity...');
 const browserHealth=await fetch(`${browserApi.replace(/\/$/,'')}/health/ready`,{headers:{Origin:web.origin},signal:AbortSignal.timeout(5000)});
 if(!browserHealth.ok||browserHealth.headers.get('access-control-allow-origin')!==web.origin||browserHealth.headers.get('access-control-allow-credentials')!=='true')throw new Error('Browser API health or credentialed origin check failed. Check WEB_ORIGIN and NEXT_PUBLIC_AIMS_API_URL.');
 if(!stopping)console.log(`Local environment ready.\nFrontend: ${web.origin}\nAPI: http://${host}:${apiPort}\nHealth: http://${host}:${apiPort}/health/ready\nPress Ctrl+C to stop these processes. Docker services and data will remain.`);
}catch(error){console.error(`Local startup failed: ${error.message}\nCheck .env.local and complete bootstrap/migrate/seed; ensure docker compose up -d has succeeded.`);await stop(1)}
