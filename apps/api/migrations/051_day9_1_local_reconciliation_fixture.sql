BEGIN;
-- Local verification fixtures only.
INSERT INTO finance_reporting_authorities(id,user_id,scope,department_id,active) VALUES('d9000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000011','DEPARTMENT','00000000-0000-4000-8000-000000000001',true) ON CONFLICT DO NOTHING;
WITH base AS(SELECT * FROM approval_cases ORDER BY created_at LIMIT 1),fixture(id,revision,status,created_at,completed_at)AS(VALUES
('d9100000-0000-4000-8000-000000000001'::uuid,990001,'APPROVED','2098-01-01'::timestamptz,'2098-01-02'::timestamptz),
('d9100000-0000-4000-8000-000000000002'::uuid,990002,'REJECTED','2098-01-02'::timestamptz,'2098-01-05'::timestamptz),
('d9100000-0000-4000-8000-000000000003'::uuid,990003,'PENDING','2098-01-03'::timestamptz,NULL::timestamptz))
INSERT INTO approval_cases(id,payment_request_id,request_revision,validation_run_id,finance_context_snapshot_id,financial_analysis_run_id,policy_decision_run_id,policy_version_id,evidence_fingerprint,approval_plan,source,status,created_by,created_at,completed_at,is_current)
SELECT f.id,b.payment_request_id,f.revision,b.validation_run_id,b.finance_context_snapshot_id,b.financial_analysis_run_id,b.policy_decision_run_id,b.policy_version_id,b.evidence_fingerprint,b.approval_plan,b.source,f.status,b.created_by,f.created_at,f.completed_at,false FROM base b CROSS JOIN fixture f ON CONFLICT DO NOTHING;
WITH base AS(SELECT created_by FROM approval_cases WHERE id='d9100000-0000-4000-8000-000000000001')
INSERT INTO approval_actions(id,approval_case_id,actor_id,action,reason,channel,command_key,acted_at)
SELECT v.id,v.case_id,b.created_by,v.action,'Day 9.1 reconciliation fixture','WEB',v.command_key,'2098-01-06' FROM base b CROSS JOIN(VALUES
('d9200000-0000-4000-8000-000000000001'::uuid,'d9100000-0000-4000-8000-000000000001'::uuid,'APPROVE','d9300000-0000-4000-8000-000000000001'::uuid),
('d9200000-0000-4000-8000-000000000002'::uuid,'d9100000-0000-4000-8000-000000000002'::uuid,'REJECT','d9300000-0000-4000-8000-000000000002'::uuid),
('d9200000-0000-4000-8000-000000000003'::uuid,'d9100000-0000-4000-8000-000000000002'::uuid,'REQUEST_CLARIFICATION','d9300000-0000-4000-8000-000000000003'::uuid),
('d9200000-0000-4000-8000-000000000004'::uuid,'d9100000-0000-4000-8000-000000000002'::uuid,'REQUEST_CLARIFICATION','d9300000-0000-4000-8000-000000000004'::uuid))v(id,case_id,action,command_key) ON CONFLICT DO NOTHING;
COMMIT;
