# AIMS Migration Inventory

The Day 10.1 clean-database test applies all 53 SQL files below in lexical order with `ON_ERROR_STOP=1`. Historical migrations are immutable; local/demo fixture migrations are explicitly identified by name, `052` removes Day 9 reconciliation fixtures so reporting is not polluted, and `053` records the application-compatible schema version used by readiness.

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
```

For a future production release, evaluate a checksum manifest and an optional baseline migration for deployment ergonomics. Preserve the full historical chain for audit and never destructively squash an already-used production database.
