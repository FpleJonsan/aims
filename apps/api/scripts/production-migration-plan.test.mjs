import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import {DEVELOPMENT_FIXTURE_MIGRATIONS,developmentFixtureSql,productionMigrationSql,validateMigrationNames} from "./production-migration-plan.mjs";

const root=path.resolve(import.meta.dirname,"../../..");
const directory=path.join(root,"apps/api/migrations");
const names=(await readdir(directory)).filter(name=>/^\d{3}_.*\.sql$/.test(name)).sort();

test("production plan accounts for the immutable 001-071 chain",()=>{
 assert.doesNotThrow(()=>validateMigrationNames(names));
 assert.equal(names.length,71);
 assert.equal(DEVELOPMENT_FIXTURE_MIGRATIONS.size,14);
});

test("production SQL contains no known development identity or fixture marker",async()=>{
 let deferred=0,filtered=0;
 for(const name of names){
  const source=await readFile(path.join(directory,name),"utf8"),sql=productionMigrationSql(name,source);
  if(sql===null){deferred+=1;continue}
  if(sql!==source)filtered+=1;
  assert.doesNotMatch(sql,/demo\.|competition\.|@aims\.local|DEV-DEMO-PAYMENTS/);
 }
 assert.equal(deferred,14);assert.equal(filtered,2);
});

test("mixed migration fixture transforms fail closed on checksum drift",async()=>{
 const source=await readFile(path.join(directory,"048_day9_finance_intelligence.sql"),"utf8");
 assert.throws(()=>productionMigrationSql("048_day9_finance_intelligence.sql",`${source}\n-- drift`),/checksum mismatch/);
});

test("development policy fixture is sequenced through DRAFT on schema 71",async()=>{
 const source=await readFile(path.join(directory,"010_day5_local_demo_policy.sql"),"utf8"),sql=developmentFixtureSql("010_day5_local_demo_policy.sql",source);
 assert.match(sql,/1,'DRAFT'/);assert.match(sql,/SET status='ACTIVE'/);
});
