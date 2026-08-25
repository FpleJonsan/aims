BEGIN;
INSERT INTO users(id,external_subject,email,display_name,department_id,active) VALUES
 ('10000000-0000-4000-8000-000000000011','demo.finance.scoped','finance.scoped@aims.local','Demo Scoped Finance Controller','00000000-0000-4000-8000-000000000002',true),
 ('10000000-0000-4000-8000-000000000012','demo.finance.revoked','finance.revoked@aims.local','Demo Revoked Finance Controller','00000000-0000-4000-8000-000000000002',true)
ON CONFLICT(id) DO NOTHING;
INSERT INTO user_roles(user_id,role) VALUES
 ('10000000-0000-4000-8000-000000000011','FINANCE'),('10000000-0000-4000-8000-000000000012','FINANCE') ON CONFLICT DO NOTHING;
INSERT INTO finance_control_authorities(id,user_id,scope,department_id,active,allow_self_control) VALUES
 ('f1000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011','DEPARTMENT','00000000-0000-4000-8000-000000000002',true,false),
 ('f1000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000012','ORGANIZATION',NULL,false,false)
ON CONFLICT DO NOTHING;
COMMIT;
