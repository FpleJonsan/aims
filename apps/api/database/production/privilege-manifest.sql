\set ON_ERROR_STOP on

DO $$
DECLARE role_name text; attrs record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['aims_app','aims_finance_executor','aims_finance_runtime','aims_payment_executor','aims_payment_runtime'] LOOP
    SELECT * INTO attrs FROM pg_roles WHERE rolname=role_name;
    IF NOT FOUND OR attrs.rolsuper OR attrs.rolcreatedb OR attrs.rolcreaterole OR attrs.rolreplication OR attrs.rolbypassrls THEN
      RAISE EXCEPTION 'unsafe runtime role attributes: %',role_name;
    END IF;
    IF has_schema_privilege(role_name,'public','CREATE') THEN RAISE EXCEPTION 'runtime schema CREATE drift: %',role_name;END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_owner' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'controlled NOLOGIN owner missing or unsafe';END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aims_migrator' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'migration role boundary missing or unsafe';END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'aims_owner' THEN RAISE EXCEPTION 'database owner drift';END IF;
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='public')<>'aims_owner' THEN RAISE EXCEPTION 'public schema owner drift';END IF;
  IF has_database_privilege('public',current_database(),'CONNECT') THEN RAISE EXCEPTION 'PUBLIC database CONNECT drift';END IF;
  IF NOT has_database_privilege('aims_migrator',current_database(),'CONNECT') THEN RAISE EXCEPTION 'migrator database CONNECT missing';END IF;
  IF NOT has_database_privilege('aims_app',current_database(),'CONNECT') OR NOT has_database_privilege('aims_finance_runtime',current_database(),'CONNECT') OR NOT has_database_privilege('aims_payment_runtime',current_database(),'CONNECT') THEN RAISE EXCEPTION 'runtime database CONNECT drift';END IF;
  IF NOT pg_has_role('aims_migrator','aims_owner','MEMBER') THEN RAISE EXCEPTION 'migrator owner membership missing';END IF;
  IF pg_has_role('aims_app','aims_migrator','MEMBER') OR pg_has_role('aims_app','aims_finance_executor','MEMBER') OR pg_has_role('aims_app','aims_payment_executor','MEMBER') THEN RAISE EXCEPTION 'normal runtime can switch to a privileged role';END IF;
  IF pg_has_role('aims_app','aims_owner','MEMBER') OR pg_has_role('aims_finance_runtime','aims_owner','MEMBER') OR pg_has_role('aims_payment_runtime','aims_owner','MEMBER') THEN RAISE EXCEPTION 'runtime can switch to owner';END IF;
  IF pg_has_role('aims_finance_runtime','aims_payment_executor','MEMBER') OR pg_has_role('aims_payment_runtime','aims_finance_executor','MEMBER') THEN RAISE EXCEPTION 'cross-executor membership drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','S','v','m') AND pg_get_userbyid(c.relowner)<>'aims_owner') THEN RAISE EXCEPTION 'application relation owner drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)<>'aims_owner') THEN RAISE EXCEPTION 'application function owner drift';END IF;
  IF EXISTS(WITH application_tables AS MATERIALIZED (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')) SELECT 1 FROM application_tables WHERE has_table_privilege('public',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN RAISE EXCEPTION 'PUBLIC table privilege drift';END IF;
  IF EXISTS(WITH application_sequences AS MATERIALIZED (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S') SELECT 1 FROM application_sequences WHERE has_sequence_privilege('public',oid,'USAGE,SELECT,UPDATE')) THEN RAISE EXCEPTION 'PUBLIC sequence privilege drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('public',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'PUBLIC function EXECUTE drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND pg_get_userbyid(p.proowner)<>'aims_owner') THEN RAISE EXCEPTION 'SECURITY DEFINER owner drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND NOT ('search_path=pg_catalog, public'=ANY(COALESCE(p.proconfig,ARRAY[]::text[])))) THEN RAISE EXCEPTION 'SECURITY DEFINER search_path drift';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('public',p.oid,'EXECUTE')) THEN RAISE EXCEPTION 'PUBLIC trusted-function EXECUTE drift';END IF;
END
$$;

-- Exact executor allowlists.
DO $$
DECLARE unexpected text;
BEGIN
 SELECT string_agg(p.oid::regprocedure::text,',') INTO unexpected FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND has_function_privilege('aims_finance_executor',p.oid,'EXECUTE')
 AND p.oid::regprocedure::text NOT IN('aims_authenticated_finance_actor()','complete_finance_control_pass(uuid,uuid)');
 IF unexpected IS NOT NULL THEN RAISE EXCEPTION 'Finance executor function drift: %',unexpected;END IF;
 SELECT string_agg(p.oid::regprocedure::text,',') INTO unexpected FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND has_function_privilege('aims_payment_executor',p.oid,'EXECUTE')
 AND p.oid::regprocedure::text NOT IN('aims_authenticated_payment_actor()','attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text)','record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean)','begin_payment_slip_security_scan(uuid,uuid,integer,text)','complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text)');
 IF unexpected IS NOT NULL THEN RAISE EXCEPTION 'Payment executor function drift: %',unexpected;END IF;
END
$$;
