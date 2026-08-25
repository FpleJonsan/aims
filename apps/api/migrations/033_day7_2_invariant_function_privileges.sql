BEGIN;

GRANT SELECT ON finance_control_runs,finance_control_checks,
  finance_control_confirmations,finance_control_exceptions TO aims_app;

ALTER FUNCTION invalidate_approval_for_evidence_change() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION invalidate_day7_for_material_request_change() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION invalidate_finance_control_for_authority_change() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION invalidate_ready_for_new_duplicate() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION clear_readiness_for_control_supersession() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION enforce_ready_for_payment() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION enforce_finance_control_lifecycle() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION lock_duplicate_control() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION aims_dependent_request_serialization() SECURITY DEFINER SET search_path=pg_catalog,public;
ALTER FUNCTION aims_require_request_serialization(uuid) SECURITY DEFINER SET search_path=pg_catalog,public;

REVOKE ALL ON FUNCTION invalidate_approval_for_evidence_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION invalidate_day7_for_material_request_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION invalidate_finance_control_for_authority_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION invalidate_ready_for_new_duplicate() FROM PUBLIC;
REVOKE ALL ON FUNCTION clear_readiness_for_control_supersession() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_ready_for_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_finance_control_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION lock_duplicate_control() FROM PUBLIC;
REVOKE ALL ON FUNCTION aims_dependent_request_serialization() FROM PUBLIC;
REVOKE ALL ON FUNCTION aims_require_request_serialization(uuid) FROM PUBLIC;

COMMIT;
