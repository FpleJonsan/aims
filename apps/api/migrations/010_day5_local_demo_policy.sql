-- Synthetic local-development/demo policy only. Replace through the Policy Admin API in real environments.
BEGIN;
INSERT INTO policy_sets(id,code,name,description,status,created_by) VALUES
 ('90000000-0000-4000-8000-000000000001','DEV-DEMO-PAYMENTS','Synthetic local demo payment policy','Development and test configuration; not production policy.','ACTIVE','10000000-0000-4000-8000-000000000002');
INSERT INTO policy_versions(id,policy_set_id,version,status,effective_from,evaluation_version,created_by,activated_by,activated_at) VALUES
 ('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001',1,'ACTIVE','2020-01-01T00:00:00Z','policy-evaluator:v1','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',now());
INSERT INTO policy_rules(id,policy_version_id,code,name,priority,effect,conditions,approval_steps,required_evidence,auto_approval_eligible,exception_code,exception_reason,justification_role) VALUES
 ('90000000-0000-4000-8000-000000000010','90000000-0000-4000-8000-000000000002','DEV-HIGH-RISK-JUSTIFICATION','High risk requires explanation',10,'REQUIRE_JUSTIFICATION','{"riskLevels":["HIGH","CRITICAL"]}','[]','[]',false,'HIGH_RISK_JUSTIFICATION','High or critical human-final risk requires controlled Finance justification.','FINANCE'),
 ('90000000-0000-4000-8000-000000000011','90000000-0000-4000-8000-000000000002','DEV-SMALL-SAFE','Small safe payment',100,'ALLOW_NO_APPROVAL','{"amountMinorMax":"100000","riskLevels":["LOW"]}','[]','[]',true,NULL,NULL,NULL),
 ('90000000-0000-4000-8000-000000000012','90000000-0000-4000-8000-000000000002','DEV-AM-REVIEW','Department AM review',200,'REQUIRE_APPROVAL','{"amountMinorMin":"100001","amountMinorMax":"5000000"}','[{"sequence":1,"requiredRole":"AM","authorityScope":"DEPARTMENT","mandatory":true,"reason":"Configured development amount band"}]','[]',false,NULL,NULL,NULL),
 ('90000000-0000-4000-8000-000000000013','90000000-0000-4000-8000-000000000002','DEV-DIRECTOR-REVIEW','Director review',300,'REQUIRE_APPROVAL','{"amountMinorMin":"5000001"}','[{"sequence":1,"requiredRole":"AM","authorityScope":"DEPARTMENT","mandatory":true,"reason":"Configured development escalation"},{"sequence":2,"requiredRole":"DIRECTOR","authorityScope":"ORGANIZATION","mandatory":true,"reason":"Configured development high-value authority"}]','[]',false,NULL,NULL,NULL);
COMMIT;
