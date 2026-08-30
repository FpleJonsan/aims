\set ON_ERROR_STOP on
SET ROLE aims_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC,aims_app,aims_finance_executor,aims_finance_runtime,aims_payment_executor,aims_payment_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
-- PostgreSQL's implicit PUBLIC EXECUTE for functions is a global default;
-- schema-scoped default revokes cannot remove a global default grant.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Migrations grant application privileges explicitly, object by object. These
-- are the only callable trusted entry points for executor capabilities.
GRANT EXECUTE ON FUNCTION aims_authenticated_finance_actor() TO aims_finance_executor;
GRANT EXECUTE ON FUNCTION complete_finance_control_pass(uuid,uuid) TO aims_finance_executor;
GRANT EXECUTE ON FUNCTION aims_authenticated_payment_actor() TO aims_payment_executor;
GRANT EXECUTE ON FUNCTION attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text) TO aims_payment_executor;
GRANT EXECUTE ON FUNCTION record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean) TO aims_payment_executor;
GRANT EXECUTE ON FUNCTION begin_payment_slip_security_scan(uuid,uuid,integer,text) TO aims_payment_executor;
GRANT EXECUTE ON FUNCTION complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text) TO aims_payment_executor;

RESET ROLE;
