BEGIN;

GRANT USAGE ON SCHEMA public TO aims_app;
GRANT SELECT ON departments, users, user_roles TO aims_app;
GRANT SELECT, INSERT, UPDATE ON payment_requests, payment_documents, ticket_counters TO aims_app;
GRANT SELECT, INSERT ON audit_events TO aims_app;

COMMIT;
