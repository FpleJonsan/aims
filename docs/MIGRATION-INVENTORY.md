# AIMS Migration Inventory

The repository contains all 71 immutable SQL files below in lexical order. Production uses `apps/api/scripts/production-migrate.mjs`: it validates all 71 names, defers 14 fixture-only files, checksum-validates and removes fixture inserts from mixed migrations 048 and 054, executes every schema-bearing migration with `ON_ERROR_STOP`, then runs hardening, privilege and no-fixture verification. Development applies the same production-safe schema/system layer before its separate fixture layer. The required schema is version 71 with latest migration `071_p20_7a_enterprise_ui_contracts`.

| Range | Purpose |
| --- | --- |
| 001–003 | Foundation, local demo identities, runtime grants |
| 004 | Validation |
| 005–007 | Finance Context, demo finance seed, snapshot constraints |
| 008 | Financial Analysis |
| 009–012 | Policy, demo policy, and hardening |
| 013–020 | Approval, demo authorities, Telegram/concurrency hardening |
| 021–035 | Final Finance Control and database trust-boundary hardening |
| 036–047 | Payment, local authority, idempotency/atomicity/payment-slip hardening |
| 048–052 | Dashboard/Finance Intelligence, failure history, local reporting fixtures and cleanup |
| 053 | Required schema-version readiness marker |
| 054 | P1-L external identity mapping, opaque server sessions, and authentication audit attribution |
| 055–056 | Document security and trusted payment-slip transitions |
| 057–058 | Durable document worker and observability state |
| 059 | Recovery-generation fencing |
| 060 | Corporate authentication transactions |
| 061 | Provider-neutral immutable storage-object version binding |
| 062 | Password authentication and password-reset foundation |
| 063 | Finance Master and user-management foundation |
| 064 | Enterprise role and permission matrix |
| 065 | Enterprise master-data foundation |
| 066 | Versioned business-configuration platform |
| 067 | Multi-claim architecture |
| 068 | Approval matrix and approval delegation |
| 069 | Enterprise notification platform |
| 070 | AI configuration authority (Business Configuration as single AI authority) |
| 071 | Enterprise UI backend contracts |

Exact files:

```text
001_day1_foundation.sql
002_local_demo_seed.sql
003_runtime_grants.sql
004_day2_validation.sql
005_day3_finance_context.sql
006_day3_demo_finance_seed.sql
007_day3_snapshot_constraint_hardening.sql
008_day4_financial_analysis.sql
009_day5_policy_decision.sql
010_day5_local_demo_policy.sql
011_day5_1_policy_hardening.sql
012_day5_2_final_hardening.sql
013_day6_approval.sql
014_day6_local_demo_approver.sql
015_day6_approval_hardening.sql
016_day6_1_hardening.sql
017_day6_1_local_authority_matrix.sql
018_day6_2_final_hardening.sql
019_day6_2_local_authority_fixture_fix.sql
020_day6_3_final_closure.sql
021_day7_finance_control.sql
022_day7_local_finance_controllers.sql
023_day7_controlled_upstream_invalidation.sql
024_day7_1_final_hardening.sql
025_day7_1_local_scoped_authorities.sql
026_day7_1_trigger_shape_correction.sql
027_day7_1_authority_guard.sql
028_day7_1_upstream_chain_invalidation.sql
029_day7_1_terminal_consistency.sql
030_day7_1_nested_invalidation_correction.sql
031_day7_1_database_transition_audit.sql
032_day7_2_database_trust_boundary.sql
033_day7_2_invariant_function_privileges.sql
034_day7_2_child_guard_shape_correction.sql
035_day7_2_audit_correlation_correction.sql
036_day8_payments.sql
037_day8_local_payment_authority.sql
038_day8_payment_command_parameter_correction.sql
039_day8_payment_slip_evidence_boundary.sql
040_day8_duplicate_trigger_shape_correction.sql
041_day8_commitment_consumption_boundary.sql
042_day8_payment_slip_write_guard.sql
043_day8_1_payment_replay_hardening.sql
044_day8_2_payment_verification_hooks.sql
045_day8_2_verification_hook_shape_correction.sql
046_day8_2_local_payment_authority_matrix.sql
047_day8_2_local_requester_masking_fixture_correction.sql
048_day9_finance_intelligence.sql
049_day9_1_intelligence_failure_history.sql
050_day9_1_local_reporting_authority_fixture.sql
051_day9_1_local_reconciliation_fixture.sql
052_day9_2_remove_reconciliation_fixtures.sql
053_day10_1_schema_readiness.sql
054_p1l_local_identity_sessions.sql
055_p3_p4_document_security.sql
056_payment_slip_trust_transition.sql
057_p7_document_scan_worker_leases.sql
058_p10_observability_claim_recovery_and_outbox_index.sql
059_p12_recovery_generation_fencing.sql
060_p13_corporate_auth_transactions.sql
061_p13_storage_object_version_binding.sql
062_p20_5a_password_auth.sql
063_p20_5b_finance_master_users.sql
064_p21_role_permission_matrix.sql
065_p20_5c_master_data_foundation.sql
066_p20_5d_business_configuration_platform.sql
067_p20_5e_multi_claim_architecture.sql
068_p20_5f_approval_matrix_and_delegation.sql
069_p20_5g_notification_platform.sql
070_p20_5h_ai_configuration_authority.sql
071_p20_7a_enterprise_ui_contracts.sql
```

For a future production release, evaluate a checksum manifest and an optional baseline migration for deployment ergonomics. Preserve the full historical chain for audit and never destructively squash an already-used production database.
