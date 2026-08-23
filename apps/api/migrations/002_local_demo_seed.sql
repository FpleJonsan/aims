BEGIN;

INSERT INTO departments (id, code, name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'OPS', 'Operations'),
  ('00000000-0000-4000-8000-000000000002', 'FIN', 'Finance')
ON CONFLICT (code) DO NOTHING;

INSERT INTO users (id, external_subject, email, display_name, department_id) VALUES
  ('10000000-0000-4000-8000-000000000001', 'demo.requester', 'requester@aims.local', 'Demo Requester', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'demo.finance', 'finance@aims.local', 'Demo Finance', '00000000-0000-4000-8000-000000000002')
ON CONFLICT (external_subject) DO NOTHING;

INSERT INTO user_roles (user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', 'REQUESTER'),
  ('10000000-0000-4000-8000-000000000002', 'FINANCE')
ON CONFLICT DO NOTHING;

COMMIT;
