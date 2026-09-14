BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=69 AND migration_id='069_p20_5g_notification_platform') THEN
  RAISE EXCEPTION 'migration 070 requires schema version 69 (069_p20_5g_notification_platform)';
 END IF;
END;
$$;

-- P20.5H — AI Governance Consolidation. Business Configuration's published
-- "ai" category (configuration_versions) becomes the single authoritative
-- source for AI runtime behavior: enabled, provider, model, temperature,
-- maxTokens, and every per-module feature flag. Application code no longer
-- reads ai_feature_configuration; that table is retained only as a
-- historical artifact (no longer written or read) and may be dropped in a
-- future migration once operators have confirmed the new authority.
--
-- This seeds the first published "ai" version directly from
-- ai_feature_configuration's current values, so a deployment that already
-- had AI enabled there does not silently go dark the moment this migration
-- lands, before an operator republishes through the new authority.
INSERT INTO configuration_versions(
  id, category, version, status, payload, reason, created_at, updated_at, published_at
)
SELECT
  gen_random_uuid(),
  'ai',
  1,
  'published',
  jsonb_build_object(
    'enabled', master.enabled,
    'provider', 'openai-compatible',
    'model', 'gpt-5-mini',
    'temperature', 0.2,
    'maxTokens', 4096,
    'apiKeyReference', 'OPENAI_API_KEY',
    'validationAiEnabled', master.enabled AND doc_extraction.enabled AND doc_validation.enabled,
    'documentExtractionEnabled', master.enabled AND doc_extraction.enabled,
    'documentValidationEnabled', master.enabled AND doc_validation.enabled,
    'financialAnalysisAiEnabled', master.enabled AND (risk.enabled OR spending.enabled OR compliance.enabled),
    'financialRiskAnalysisEnabled', master.enabled AND risk.enabled,
    'spendingPatternAnalysisEnabled', master.enabled AND spending.enabled,
    'complianceAnalysisEnabled', master.enabled AND compliance.enabled,
    'financeWatchEnabled', master.enabled AND watch.enabled,
    'askAimsEnabled', master.enabled AND ask.enabled,
    'manualModeAlwaysAvailable', true
  ),
  'Migration 070: seeded from ai_feature_configuration to preserve current AI enablement while consolidating AI configuration authority into Business Configuration',
  now(), now(), now()
FROM
  (SELECT enabled FROM ai_feature_configuration WHERE feature='AI_MASTER') master,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='DOCUMENT_EXTRACTION') doc_extraction,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='DOCUMENT_VALIDATION') doc_validation,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='FINANCIAL_RISK_ANALYSIS') risk,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='SPENDING_PATTERN_ANALYSIS') spending,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='COMPLIANCE_ANALYSIS') compliance,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='FINANCE_WATCH') watch,
  (SELECT enabled FROM ai_feature_configuration WHERE feature='ASK_AIMS') ask
WHERE NOT EXISTS (SELECT 1 FROM configuration_versions WHERE category='ai' AND status='published');

UPDATE aims_schema_version SET version=70,migration_id='070_p20_5h_ai_configuration_authority',applied_at=now() WHERE singleton=true AND version=69;
COMMIT;
