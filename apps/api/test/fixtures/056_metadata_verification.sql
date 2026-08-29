\set ON_ERROR_STOP on

SELECT version,migration_id FROM aims_schema_version WHERE singleton=true;
SELECT proname,prosecdef,proconfig
FROM pg_proc
WHERE proname IN ('begin_payment_slip_security_scan','complete_payment_slip_security_scan')
ORDER BY proname;
SELECT tgname,tgenabled
FROM pg_trigger
WHERE tgrelid='payment_documents'::regclass AND NOT tgisinternal
ORDER BY tgname;
SELECT
 has_function_privilege('aims_app','begin_payment_slip_security_scan(uuid,uuid,integer,text)','EXECUTE') AS app_begin,
 has_function_privilege('aims_payment_executor','begin_payment_slip_security_scan(uuid,uuid,integer,text)','EXECUTE') AS executor_begin;
