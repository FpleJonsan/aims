BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=70 AND migration_id='070_p20_5h_ai_configuration_authority') THEN
  RAISE EXCEPTION 'migration 071 requires schema version 70 (070_p20_5h_ai_configuration_authority)';
 END IF;
END;
$$;

ALTER TABLE users ADD COLUMN language varchar(10) NOT NULL DEFAULT 'en'
  CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$');
GRANT UPDATE(display_name,language) ON users TO aims_app;

ALTER TABLE configuration_versions DROP CONSTRAINT configuration_versions_category_chk;
ALTER TABLE configuration_versions ADD CONSTRAINT configuration_versions_category_chk
  CHECK (category IN ('company','finance','workflow','numbering','ai','notifications','system'));

CREATE INDEX audit_events_occurred_idx ON audit_events(occurred_at DESC,id);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_id,occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX notification_outbox_recipient_history_idx
  ON notification_outbox(recipient_user_id,created_at DESC,id) WHERE recipient_user_id IS NOT NULL;

UPDATE aims_schema_version SET version=71,migration_id='071_p20_7a_enterprise_ui_contracts',applied_at=now()
WHERE singleton=true AND version=70;

COMMIT;
