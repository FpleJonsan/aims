-- Normalize the synthetic local-development insufficient-authority fixture.
BEGIN;
UPDATE approval_authorities
SET maximum_amount_minor = 1000,
    active = true
WHERE user_id = '10000000-0000-4000-8000-000000000005'
  AND authority_role = 'AM'
  AND authority_scope = 'DEPARTMENT';
COMMIT;
