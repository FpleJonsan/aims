import {createHash} from "node:crypto";

export const PRODUCTION_SCHEMA_VERSION=71;
export const PRODUCTION_MIGRATION_ID="071_p20_7a_enterprise_ui_contracts";

export const DEVELOPMENT_FIXTURE_MIGRATIONS=new Set([
 "002_local_demo_seed.sql",
 "006_day3_demo_finance_seed.sql",
 "010_day5_local_demo_policy.sql",
 "014_day6_local_demo_approver.sql",
 "017_day6_1_local_authority_matrix.sql",
 "019_day6_2_local_authority_fixture_fix.sql",
 "022_day7_local_finance_controllers.sql",
 "025_day7_1_local_scoped_authorities.sql",
 "037_day8_local_payment_authority.sql",
 "046_day8_2_local_payment_authority_matrix.sql",
 "047_day8_2_local_requester_masking_fixture_correction.sql",
 "050_day9_1_local_reporting_authority_fixture.sql",
 "051_day9_1_local_reconciliation_fixture.sql",
 "052_day9_2_remove_reconciliation_fixtures.sql",
]);

const MIXED_MIGRATION_CHECKSUMS=new Map([
 ["048_day9_finance_intelligence.sql","4b8e16998f71bba8c18f1fc8c37759654df49c4224a323156ffcb5c362a2715b"],
 ["054_p1l_local_identity_sessions.sql","91818187e048862c33b835cd78befdd563eabbbf7da18d29869d41c3c5f15b92"],
]);

function removeExact(source,fragment,name){
 if(!source.includes(fragment))throw new Error(`production migration fixture boundary changed: ${name}`);
 return source.replace(fragment,"");
}

export function productionMigrationSql(name,source){
 if(DEVELOPMENT_FIXTURE_MIGRATIONS.has(name))return null;
 const checksum=MIXED_MIGRATION_CHECKSUMS.get(name);
 if(checksum){
  const actual=createHash("sha256").update(source).digest("hex");
  if(actual!==checksum)throw new Error(`production migration checksum mismatch: ${name}`);
 }
 if(name==="048_day9_finance_intelligence.sql")return removeExact(source,`INSERT INTO finance_reporting_authorities(id,user_id,scope,department_id,active) VALUES
 ('d9000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','ORGANIZATION',NULL,true),
 ('d9000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000009','ORGANIZATION',NULL,true),
 ('d9000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','DEPARTMENT','00000000-0000-4000-8000-000000000002',true)
ON CONFLICT DO NOTHING;

`,name);
 if(name==="054_p1l_local_identity_sessions.sql")return removeExact(source,`INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
SELECT gen_random_uuid(),id,'local','aims-local',external_subject
FROM users
WHERE external_subject LIKE 'demo.%'
ON CONFLICT (issuer,subject) DO NOTHING;

INSERT INTO user_external_identities(id,user_id,provider,issuer,subject)
SELECT gen_random_uuid(),id,'competition','aims-competition',external_subject
FROM users
WHERE external_subject LIKE 'competition.%'
ON CONFLICT (issuer,subject) DO NOTHING;

`,name);
 return source;
}

export function validateMigrationNames(names){
 if(names.length!==71||names[0]!=="001_day1_foundation.sql"||names.at(-1)!=="071_p20_7a_enterprise_ui_contracts.sql")throw new Error("expected immutable migration chain 001-071");
 for(let index=0;index<names.length;index+=1)if(Number(names[index].slice(0,3))!==index+1)throw new Error(`migration sequence gap at ${names[index]}`);
}

export function developmentFixtureSql(name,source){
 if(name!=="010_day5_local_demo_policy.sql")return source;
 const active=`('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001',1,'ACTIVE','2020-01-01T00:00:00Z','policy-evaluator:v1','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',now());`;
 const draft=`('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001',1,'DRAFT','2020-01-01T00:00:00Z','policy-evaluator:v1','10000000-0000-4000-8000-000000000002',NULL,NULL);`;
 if(!source.includes(active))throw new Error("development policy fixture boundary changed");
 return source.replace(active,draft).replace("COMMIT;",`UPDATE policy_versions SET status='ACTIVE',activated_by='10000000-0000-4000-8000-000000000002',activated_at=now() WHERE id='90000000-0000-4000-8000-000000000002';\nCOMMIT;`);
}

export const PRODUCTION_FIXTURE_ASSERTION_SQL=`DO $$
DECLARE fixture_count bigint;
BEGIN
 SELECT
  (SELECT count(*) FROM users WHERE external_subject LIKE 'demo.%' OR external_subject LIKE 'competition.%' OR email LIKE '%@aims.local')+
  (SELECT count(*) FROM departments WHERE id IN('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'))+
  (SELECT count(*) FROM fiscal_periods WHERE id='30000000-0000-4000-8000-000000000001')+
  (SELECT count(*) FROM budgets WHERE id::text LIKE '31000000-0000-4000-8000-00000000000%')+
  (SELECT count(*) FROM policy_sets WHERE code='DEV-DEMO-PAYMENTS')+
  (SELECT count(*) FROM approval_cases WHERE id::text LIKE 'd9100000-0000-4000-8000-00000000000%')
 INTO fixture_count;
 IF fixture_count<>0 THEN RAISE EXCEPTION 'production fixture records present: %',fixture_count; END IF;
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton AND version=71 AND migration_id='071_p20_7a_enterprise_ui_contracts') THEN RAISE EXCEPTION 'production schema identity mismatch'; END IF;
 IF (SELECT count(*) FROM roles)<>5 OR NOT EXISTS(SELECT 1 FROM roles WHERE code='ADMIN' AND is_system) THEN RAISE EXCEPTION 'system role bootstrap mismatch'; END IF;
 IF (SELECT count(*) FROM permissions)<1 THEN RAISE EXCEPTION 'system permission bootstrap mismatch'; END IF;
 IF (SELECT count(*) FROM ai_feature_configuration)<>8 OR EXISTS(SELECT 1 FROM ai_feature_configuration WHERE enabled) THEN RAISE EXCEPTION 'AI defaults mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM configuration_versions WHERE category='ai' AND status='published' AND (payload->>'enabled')='true') THEN RAISE EXCEPTION 'AI Business Configuration defaults mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM master_data_currencies WHERE code='MYR' AND is_default AND active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'default currency missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM master_data_payment_methods WHERE code='BANK_TRANSFER' AND is_default AND active AND deleted_at IS NULL) THEN RAISE EXCEPTION 'default payment method missing'; END IF;
END$$;`;
