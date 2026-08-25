BEGIN;
CREATE OR REPLACE FUNCTION guard_payment_slip_write() RETURNS trigger SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF COALESCE(NEW.document_type,OLD.document_type)='PAYMENT_SLIP' THEN
  PERFORM public.aims_authenticated_payment_actor();
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'payment slip metadata is immutable';END IF;
 END IF;RETURN COALESCE(NEW,OLD);END;$$ LANGUAGE plpgsql;
REVOKE ALL ON FUNCTION guard_payment_slip_write() FROM PUBLIC;
CREATE TRIGGER payment_documents_payment_slip_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_documents FOR EACH ROW EXECUTE FUNCTION guard_payment_slip_write();
COMMIT;
