BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=68 AND migration_id='068_p20_5f_approval_matrix_and_delegation') THEN
  RAISE EXCEPTION 'migration 069 requires schema version 68 (068_p20_5f_approval_matrix_and_delegation)';
 END IF;
END;
$$;

-- P20.5G: Enterprise Notification Platform. Additive only. Telegram delivery
-- for Approval (notification_outbox, telegram_identity_bindings,
-- approval_action_tokens, telegram_pending_interactions,
-- telegram_webhook_updates) already exists from Day 6 (013) onward and is
-- reused as-is: the generic dispatcher added here claims rows from the same
-- notification_outbox table for every event_type OTHER than
-- APPROVAL_STEP_ACTIVATED (which keeps using the existing interactive
-- Approval/Telegram delivery path), so no data migration or schema change is
-- needed on that table. The one new table below is per-user delivery
-- preference (enable/disable/mute), scoped per channel so future channels
-- add their own row shape without touching this one's meaning.
CREATE TABLE notification_preferences(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 channel varchar(24) NOT NULL CHECK(channel IN('TELEGRAM')),
 enabled boolean NOT NULL DEFAULT true,
 muted_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,channel)
);

GRANT SELECT,INSERT ON notification_preferences TO aims_app;
GRANT UPDATE(enabled,muted_until,updated_at) ON notification_preferences TO aims_app;

UPDATE aims_schema_version SET version=69,migration_id='069_p20_5g_notification_platform',applied_at=now()
WHERE singleton=true AND version=68;
COMMIT;
