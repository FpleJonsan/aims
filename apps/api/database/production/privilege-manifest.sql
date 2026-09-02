\set ON_ERROR_STOP on

DO $$
DECLARE role_name text; attrs record;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['aims_app','aims_finance_executor','aims_finance_runtime','aims_payment_executor','aims_payment_runtime','aims_document_worker_executor','aims_document_worker_runtime'] LOOP
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
  IF NOT has_database_privilege('aims_document_worker_runtime',current_database(),'CONNECT') THEN RAISE EXCEPTION 'document worker database CONNECT missing';END IF;
  IF NOT pg_has_role('aims_migrator','aims_owner','MEMBER') THEN RAISE EXCEPTION 'migrator owner membership missing';END IF;
  IF pg_has_role('aims_app','aims_migrator','MEMBER') OR pg_has_role('aims_app','aims_finance_executor','MEMBER') OR pg_has_role('aims_app','aims_payment_executor','MEMBER') THEN RAISE EXCEPTION 'normal runtime can switch to a privileged role';END IF;
  IF pg_has_role('aims_app','aims_owner','MEMBER') OR pg_has_role('aims_finance_runtime','aims_owner','MEMBER') OR pg_has_role('aims_payment_runtime','aims_owner','MEMBER') THEN RAISE EXCEPTION 'runtime can switch to owner';END IF;
  IF pg_has_role('aims_finance_runtime','aims_payment_executor','MEMBER') OR pg_has_role('aims_payment_runtime','aims_finance_executor','MEMBER') THEN RAISE EXCEPTION 'cross-executor membership drift';END IF;
  IF NOT pg_has_role('aims_document_worker_runtime','aims_document_worker_executor','MEMBER') THEN RAISE EXCEPTION 'document worker executor membership missing';END IF;
  IF pg_has_role('aims_document_worker_runtime','aims_app','MEMBER') OR pg_has_role('aims_document_worker_runtime','aims_finance_executor','MEMBER') OR pg_has_role('aims_document_worker_runtime','aims_payment_executor','MEMBER') OR pg_has_role('aims_document_worker_runtime','aims_owner','MEMBER') OR pg_has_role('aims_document_worker_runtime','aims_migrator','MEMBER') THEN RAISE EXCEPTION 'document worker cross-authority membership drift';END IF;
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
BEGIN
 IF EXISTS(WITH expected(signature)AS(VALUES('aims_authenticated_finance_actor()'),('complete_finance_control_pass(uuid,uuid)')),actual AS(SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('aims_finance_executor',p.oid,'EXECUTE'))SELECT 1 FROM expected e FULL JOIN actual a USING(signature) WHERE e.signature IS NULL OR a.signature IS NULL) THEN RAISE EXCEPTION 'Finance executor function drift';END IF;
 IF EXISTS(WITH expected(signature)AS(VALUES('aims_authenticated_payment_actor()'),('attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text)'),('record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean)'),('begin_payment_slip_security_scan(uuid,uuid,integer,text)'),('complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text)')),actual AS(SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('aims_payment_executor',p.oid,'EXECUTE'))SELECT 1 FROM expected e FULL JOIN actual a USING(signature) WHERE e.signature IS NULL OR a.signature IS NULL) THEN RAISE EXCEPTION 'Payment executor function drift';END IF;
 IF EXISTS(WITH expected(signature)AS(VALUES('claim_next_payment_document_scan(text,integer,integer,uuid)'),('complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text)'),('payment_document_scan_worker_health()')),actual AS(SELECT p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('aims_document_worker_executor',p.oid,'EXECUTE'))SELECT 1 FROM expected e FULL JOIN actual a USING(signature) WHERE e.signature IS NULL OR a.signature IS NULL) THEN RAISE EXCEPTION 'Document worker executor function drift';END IF;
 IF has_table_privilege('aims_document_worker_runtime','payment_documents','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION 'document worker raw table mutation drift';END IF;
 IF has_function_privilege('aims_document_worker_runtime','record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean)','EXECUTE') OR has_function_privilege('aims_document_worker_runtime','complete_finance_control_pass(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'document worker financial function drift';END IF;
END
$$;

-- Exact aims_owner default ACL. PostgreSQL implicit object defaults are not
-- pg_default_acl rows; the only explicit frozen state is the global function
-- default with PUBLIC EXECUTE removed and owner EXECUTE retained.
DO $$
BEGIN
 IF EXISTS(WITH expected(owner_name,schema_name,object_type,grantee_name,privilege_type,is_grantable)AS(VALUES('aims_owner',NULL::text,'f','aims_owner','EXECUTE',false)),actual AS(SELECT owner_role.rolname owner_name,n.nspname schema_name,d.defaclobjtype object_type,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE grantee_role.rolname END grantee_name,a.privilege_type,a.is_grantable FROM pg_default_acl d JOIN pg_roles owner_role ON owner_role.oid=d.defaclrole LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace CROSS JOIN LATERAL aclexplode(COALESCE(d.defaclacl,'{}'::aclitem[]))a LEFT JOIN pg_roles grantee_role ON grantee_role.oid=a.grantee WHERE owner_role.rolname='aims_owner')SELECT 1 FROM expected e FULL JOIN actual a ON a.owner_name=e.owner_name AND a.schema_name IS NOT DISTINCT FROM e.schema_name AND a.object_type=e.object_type AND a.grantee_name=e.grantee_name AND a.privilege_type=e.privilege_type AND a.is_grantable=e.is_grantable WHERE e.owner_name IS NULL OR a.owner_name IS NULL) THEN RAISE EXCEPTION 'aims_owner default privilege drift';END IF;
END
$$;
