-- Synthetic local/demo approver identity and authority only.
BEGIN;
INSERT INTO users(id,external_subject,email,display_name,department_id) VALUES
 ('10000000-0000-4000-8000-000000000004','demo.approver','approver@aims.local','Demo Operations Approver','00000000-0000-4000-8000-000000000001') ON CONFLICT(external_subject) DO NOTHING;
INSERT INTO user_roles(user_id,role) VALUES('10000000-0000-4000-8000-000000000004','REQUESTER') ON CONFLICT DO NOTHING;
INSERT INTO approval_authorities(id,user_id,authority_role,authority_scope,department_id,minimum_amount_minor,maximum_amount_minor) VALUES
 ('a0000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','AM','DEPARTMENT','00000000-0000-4000-8000-000000000001',0,5000000),
 ('a0000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','DIRECTOR','ORGANIZATION',NULL,0,NULL)
 ON CONFLICT DO NOTHING;
COMMIT;
