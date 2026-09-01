import assert from "node:assert/strict";
import test from "node:test";
import {
  ALERT_CLASSIFICATIONS,
  ALERT_FEATURE_DEPENDENCIES,
  ALERT_GROUPING_DIMENSIONS,
  ALERT_SEVERITIES,
  ALERT_SPECIFICATIONS,
  ALERT_THRESHOLD_SOURCES,
  isAlertSpecificationActive,
  isInfrastructureIncidentOutcome,
} from "../src/infrastructure/observability/alert-specification.js";

test("provider-neutral alert catalogue has stable bounded unique contracts",()=>{
  const keys=new Set<string>();
  for(const specification of ALERT_SPECIFICATIONS){
    assert.match(specification.key,/^[A-Z][A-Z0-9_]{2,79}$/);
    assert.equal(keys.has(specification.key),false);keys.add(specification.key);
    assert.ok(ALERT_CLASSIFICATIONS.includes(specification.classification));
    assert.ok(ALERT_SEVERITIES.includes(specification.severity));
    assert.ok(ALERT_THRESHOLD_SOURCES.includes(specification.thresholdSource));
    assert.ok(ALERT_FEATURE_DEPENDENCIES.includes(specification.feature));
    assert.equal(specification.privacy,"OPERATIONAL_MINIMIZED");
    assert.ok(specification.recovery.length>0);
    assert.ok(specification.missingData.length>0);
    assert.ok(specification.owner.length>0);
    assert.ok(specification.escalationOwner.length>0);
    assert.match(specification.runbook,/^p11-runbooks\.md#[a-z0-9-]+$/);
    for(const dimension of specification.grouping)assert.ok(ALERT_GROUPING_DIMENSIONS.includes(dimension));
  }
  assert.equal(keys.size,22);
});

test("actionable alerts have recovery, owners, and runbooks without provider routing",()=>{
  for(const specification of ALERT_SPECIFICATIONS.filter(value=>value.classification==="ALERT"||value.classification==="PAGE")){
    assert.ok(specification.firing.length>0&&specification.recovery.length>0);
    assert.ok(specification.owner&&specification.escalationOwner&&specification.runbook);
    assert.doesNotMatch(JSON.stringify(specification),/PagerDuty|Opsgenie|Alertmanager|Datadog|Slack|Teams|SMS/i);
  }
});

test("AI and Telegram OFF deactivate every optional-provider specification",()=>{
  const disabled={aiEnabled:false,telegramEnabled:false};
  assert.equal(ALERT_SPECIFICATIONS.filter(value=>value.feature==="AI_ENABLED").every(value=>!isAlertSpecificationActive(value,disabled)),true);
  assert.equal(ALERT_SPECIFICATIONS.filter(value=>value.feature==="TELEGRAM_ENABLED").every(value=>!isAlertSpecificationActive(value,disabled)),true);
  assert.equal(ALERT_SPECIFICATIONS.filter(value=>value.feature==="ALWAYS").every(value=>isAlertSpecificationActive(value,disabled)),true);
});

test("normal business outcomes are never classified as infrastructure incidents",()=>{
  for(const outcome of ["APPROVAL_REJECTION","APPROVAL_CLARIFICATION","FINANCE_CONTROL_FAIL","DOCUMENT_REJECTED","PAYMENT_SUCCESS","PAYMENT_IDEMPOTENT_REPLAY","POLICY_DENIAL","LEGITIMATE_AUTHORIZATION_DENIAL","AI_MANUAL_FALLBACK"])assert.equal(isInfrastructureIncidentOutcome(outcome),false);
  assert.equal(isInfrastructureIncidentOutcome("PAYMENT_EXECUTOR_FAILURE"),true);
});

test("Payment and deterministic alert semantics preserve approved boundaries",()=>{
  const mismatch=ALERT_SPECIFICATIONS.find(value=>value.key==="PAYMENT_PAYLOAD_MISMATCH_PATTERN");
  assert.ok(mismatch);assert.notEqual(mismatch.classification,"PAGE");assert.equal(mismatch.thresholdSource,"SECURITY_POLICY_REQUIRED");assert.match(mismatch.condition,/one mismatch is not an automatic page/i);
  const replay=ALERT_SPECIFICATIONS.find(value=>value.key==="PAYMENT_IDEMPOTENT_REPLAY_RATE");
  assert.ok(replay);assert.equal(replay.classification,"WARNING");assert.match(replay.condition,/successful recovery event/i);
  const schema=ALERT_SPECIFICATIONS.find(value=>value.key==="SCHEMA_VERSION_MISMATCH");
  const readiness=ALERT_SPECIFICATIONS.find(value=>value.key==="API_REQUIRED_READINESS_FAILURE");
  assert.equal(schema?.thresholdSource,"DETERMINISTIC");assert.ok(["ALERT","PAGE"].includes(schema!.classification));
  assert.equal(readiness?.thresholdSource,"DETERMINISTIC");assert.ok(["ALERT","PAGE"].includes(readiness!.classification));
});

test("threshold ownership is explicit and no unapproved numeric threshold is embedded",()=>{
  for(const specification of ALERT_SPECIFICATIONS){
    assert.ok(ALERT_THRESHOLD_SOURCES.includes(specification.thresholdSource));
    assert.doesNotMatch(`${specification.condition} ${specification.firing} ${specification.recovery}`,/\b(?:5|10|15|30|60|100|500)\s*(?:ms|seconds?|minutes?|%|percent|requests?)\b/i);
  }
});

test("catalogue and dimensions contain no dynamic identifiers, financial values, or secrets",()=>{
  const serialized=JSON.stringify(ALERT_SPECIFICATIONS);
  for(const prohibited of ["request_id","user_id","payment_id","document_id","chat_id","correlation_id","payee","purpose","amount_minor","bank_reference","filename","cookie","token","connection_string","raw_sql","raw_provider_payload"])assert.equal(serialized.toLowerCase().includes(`"${prohibited}"`),false,prohibited);
  for(const dimension of ALERT_GROUPING_DIMENSIONS)assert.doesNotMatch(dimension,/request|user|payment|document|chat|correlation|payee|filename/i);
});

test("P11 introduces specification only and no application-side evaluator",()=>{
  assert.equal(typeof ALERT_SPECIFICATIONS,"object");
  assert.equal(ALERT_SPECIFICATIONS.some(value=>/scheduler|persistent alert state|database table/i.test(value.condition)),false);
});
