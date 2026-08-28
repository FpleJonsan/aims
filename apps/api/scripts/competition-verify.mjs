import { Pool, guardCompetition, pointRuntimeToCompetition } from "./competition-guard.mjs";

pointRuntimeToCompetition();
guardCompetition({ requireRuntimeUrls: true });
const db = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const identities = await db.query("SELECT count(*)::int count FROM users WHERE (external_subject LIKE 'competition.%' OR external_subject IN ('demo.requester','demo.finance')) AND active");
  const states = await db.query("SELECT status,count(*)::int count FROM payment_requests GROUP BY status ORDER BY status");
  const money = (await db.query(`SELECT
    COALESCE((SELECT sum(revised_amount_minor) FROM budget_versions WHERE status='ACTIVE' AND budget_id IN(SELECT id FROM budgets WHERE currency='MYR' AND status='ACTIVE')),0)::bigint budget,
    COALESCE((SELECT sum(amount_minor) FROM financial_ledger_entries WHERE currency='MYR'),0)::bigint actual,
    COALESCE((SELECT sum(amount_minor) FROM budget_commitments WHERE currency='MYR' AND status='ACTIVE'),0)::bigint committed`)).rows[0];
  const paid = await db.query(`SELECT count(*)::int count FROM payment_requests pr JOIN payments p ON p.payment_request_id=pr.id
    JOIN financial_ledger_entries l ON l.id=p.ledger_entry_id JOIN budget_commitments c ON c.payment_request_id=pr.id
    WHERE pr.status='PAID' AND (p.amount_minor<>(pr.amount*100)::bigint OR l.amount_minor<>p.amount_minor OR c.status<>'CONSUMED')`);
  const aiEvidence = await db.query(`SELECT count(*)::int count FROM ai_usage_events a JOIN payment_requests pr ON pr.id=a.payment_request_id WHERE pr.ticket_number='PAY-2026-000002'`);
  const adminAuthority = await db.query(`SELECT
    (SELECT count(*) FROM approval_authorities WHERE user_id=$1)+
    (SELECT count(*) FROM finance_control_authorities WHERE user_id=$1)+
    (SELECT count(*) FROM payment_authorities WHERE user_id=$1)+
    (SELECT count(*) FROM finance_reporting_authorities WHERE user_id=$1) count`, ["c1000000-0000-4000-8000-000000000008"]);
  const required = new Map(states.rows.map((row)=>[row.status,row.count]));
  const failures=[];
  if (identities.rows[0].count < 8) failures.push("required demo identities missing");
  if (!required.get("PENDING_APPROVAL")) failures.push("pending approval scenario missing");
  if (!required.get("NEEDS_CLARIFICATION")) failures.push("clarification scenario missing");
  if (!required.get("READY_FOR_PAYMENT")) failures.push("ready for payment scenario missing");
  if ((required.get("PAID")??0) < 5) failures.push("payment history requires at least five paid requests");
  if (paid.rows[0].count) failures.push("paid lifecycle reconciliation failed");
  if (!aiEvidence.rows[0].count) failures.push("high-risk AI advisory evidence missing");
  if (Number(adminAuthority.rows[0].count)!==0) failures.push("ADMIN was granted operational authority");
  const budget=BigInt(money.budget),actual=BigInt(money.actual),committed=BigInt(money.committed),available=budget-actual-committed;
  if (budget!==50000000n || actual!==18000000n || committed!==7000000n || available!==25000000n) failures.push(`financial baseline mismatch: ${budget}/${actual}/${committed}/${available}`);
  if (failures.length) throw new Error(`Competition verification FAIL: ${failures.join("; ")}`);
  process.stdout.write(JSON.stringify({result:"PASS",identities:identities.rows[0].count,aiAdvisoryEvents:aiEvidence.rows[0].count,adminOperationalAuthorities:0,states:Object.fromEntries(required),financialsMinor:{budget:String(budget),actual:String(actual),committed:String(committed),available:String(available),utilisationPercent:36}},null,2)+"\n");
} finally { await db.end(); }
