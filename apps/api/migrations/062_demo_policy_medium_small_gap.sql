-- Close the demo policy gap for MEDIUM human-final risk on small amounts.
-- Active policy rules are immutable, so publish a replacement version.
BEGIN;

INSERT INTO policy_versions(id,policy_set_id,version,status,effective_from,evaluation_version,created_by)
SELECT '90000000-0000-4000-8000-000000000003', policy_set_id, 2, 'DRAFT', effective_from, evaluation_version, created_by
FROM policy_versions
WHERE id='90000000-0000-4000-8000-000000000002'
ON CONFLICT (id) DO NOTHING;

INSERT INTO policy_rules(id,policy_version_id,code,name,priority,effect,conditions,approval_steps,required_evidence,auto_approval_eligible,exception_code,exception_reason,justification_role)
SELECT
  CASE code
    WHEN 'DEV-HIGH-RISK-JUSTIFICATION' THEN '90000000-0000-4000-8000-000000000020'::uuid
    WHEN 'DEV-SMALL-SAFE' THEN '90000000-0000-4000-8000-000000000021'::uuid
    WHEN 'DEV-AM-REVIEW' THEN '90000000-0000-4000-8000-000000000022'::uuid
    WHEN 'DEV-DIRECTOR-REVIEW' THEN '90000000-0000-4000-8000-000000000023'::uuid
    ELSE gen_random_uuid()
  END,
  '90000000-0000-4000-8000-000000000003',
  code,name,priority,effect,conditions,approval_steps,required_evidence,auto_approval_eligible,exception_code,exception_reason,justification_role
FROM policy_rules
WHERE policy_version_id='90000000-0000-4000-8000-000000000002'
  AND NOT EXISTS (
    SELECT 1 FROM policy_rules WHERE policy_version_id='90000000-0000-4000-8000-000000000003' AND code=policy_rules.code
  );

INSERT INTO policy_rules(id,policy_version_id,code,name,priority,effect,conditions,approval_steps,required_evidence,auto_approval_eligible,exception_code,exception_reason,justification_role)
SELECT
  '90000000-0000-4000-8000-000000000024',
  '90000000-0000-4000-8000-000000000003',
  'DEV-MEDIUM-SMALL-REVIEW',
  'Medium-risk small payment AM review',
  150,
  'REQUIRE_APPROVAL',
  '{"amountMinorMax":"100000","riskLevels":["MEDIUM"]}'::jsonb,
  '[{"sequence":1,"requiredRole":"AM","authorityScope":"DEPARTMENT","mandatory":true,"reason":"Medium human-final risk on a small payment requires department AM review"}]'::jsonb,
  '[]'::jsonb,
  false,
  NULL,
  NULL,
  NULL
WHERE EXISTS (
  SELECT 1 FROM policy_versions WHERE id='90000000-0000-4000-8000-000000000003' AND status='DRAFT'
)
AND NOT EXISTS (
  SELECT 1 FROM policy_rules WHERE policy_version_id='90000000-0000-4000-8000-000000000003' AND code='DEV-MEDIUM-SMALL-REVIEW'
);

UPDATE policy_versions
SET status='RETIRED',
    retired_by=COALESCE(activated_by,created_by,'10000000-0000-4000-8000-000000000002'),
    retired_at=COALESCE(retired_at,now())
WHERE id='90000000-0000-4000-8000-000000000002'
  AND status='ACTIVE'
  AND EXISTS (
    SELECT 1 FROM policy_versions WHERE id='90000000-0000-4000-8000-000000000003' AND status='DRAFT'
  );

UPDATE policy_versions
SET status='ACTIVE',
    activated_by=COALESCE(created_by,'10000000-0000-4000-8000-000000000002'),
    activated_at=now()
WHERE id='90000000-0000-4000-8000-000000000003'
  AND status='DRAFT';

COMMIT;
