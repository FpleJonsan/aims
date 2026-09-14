import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ClaimItemService } from "../src/application/claim-items/claim-item.service.js";
import { PaymentRequestService } from "../src/application/payment-requests/payment-request.service.js";
import type { Principal } from "../src/domain/payment-request.js";
import { Postgres } from "../src/infrastructure/database/postgres.js";

const requester: Principal = {
  id: "10000000-0000-4000-8000-000000000001",
  departmentId: "00000000-0000-4000-8000-000000000001",
  roles: ["REQUESTER"],
};
const OPS = "00000000-0000-4000-8000-000000000001";
const FIN = "00000000-0000-4000-8000-000000000002";

test("claim items drive the parent request's derived amount/currency/category, and reject a mixed currency", async () => {
  const db = new Postgres();
  const requests = new PaymentRequestService(db);
  const claimItems = new ClaimItemService(db, requests);
  try {
    const draft = await requests.initiate(requester, "claim-init");
    const first = (await claimItems.create(
      draft.id,
      { category: "Travel", departmentId: OPS, currency: "MYR", amount: "100.0000" },
      requester,
      "claim-create-1",
    )) as { id: string };
    let current = await requests.get(draft.id, requester);
    assert.equal(current.amount, "100.0000");
    assert.equal(current.currency, "MYR");
    assert.equal(current.category, "Travel");
    assert.equal(current.claimCount, 1);

    const second = (await claimItems.create(
      draft.id,
      { category: "Meals", departmentId: FIN, currency: "MYR", amount: "50.00" },
      requester,
      "claim-create-2",
    )) as { id: string };
    current = await requests.get(draft.id, requester);
    assert.equal(current.amount, "150.0000");
    assert.equal(current.category, "MIXED", "differing claim categories collapse to MIXED on the parent");
    assert.equal(current.claimCount, 2);
    assert.equal(current.claimItems.length, 2);

    await assert.rejects(
      claimItems.create(
        draft.id,
        { category: "Travel", departmentId: OPS, currency: "USD", amount: "10.00" },
        requester,
        "claim-create-mismatched-currency",
      ),
      /share one currency/,
    );

    await claimItems.update(
      draft.id,
      second.id,
      { amount: "75.00", category: "Travel" },
      requester,
      "claim-update-2",
    );
    current = await requests.get(draft.id, requester);
    assert.equal(current.amount, "175.0000");
    assert.equal(current.category, "Travel", "both claims now share one category");

    await claimItems.remove(draft.id, second.id, requester, "claim-remove-2");
    current = await requests.get(draft.id, requester);
    assert.equal(current.amount, "100.0000");
    assert.equal(current.claimCount, 1);
    assert.equal(current.claimItems.length, 1);
    assert.equal((current.claimItems[0] as { id: string }).id, first.id);

    const events = await db.pool.query(
      "SELECT action, actor_role_snapshot, actor_display_name_snapshot FROM audit_events WHERE entity_type='PAYMENT_REQUEST' AND entity_id=$1 AND action='CLAIM_ITEM_ADDED' ORDER BY occurred_at",
      [draft.id],
    );
    assert.equal(events.rowCount, 2);
    assert.deepEqual(events.rows[0].actor_role_snapshot, ["REQUESTER"]);
    assert.equal(events.rows[0].actor_display_name_snapshot, "Demo Requester");
  } finally {
    await db.onModuleDestroy();
  }
});

test("reorder requires every active claim exactly once", async () => {
  const db = new Postgres();
  const requests = new PaymentRequestService(db);
  const claimItems = new ClaimItemService(db, requests);
  try {
    const draft = await requests.initiate(requester, "claim-reorder-init");
    const a = (await claimItems.create(
      draft.id,
      { category: "Travel", departmentId: OPS, currency: "MYR", amount: "10.00" },
      requester,
      "claim-a",
    )) as { id: string; displayOrder: number };
    const b = (await claimItems.create(
      draft.id,
      { category: "Travel", departmentId: OPS, currency: "MYR", amount: "20.00" },
      requester,
      "claim-b",
    )) as { id: string; displayOrder: number };
    assert.equal(a.displayOrder, 0);
    assert.equal(b.displayOrder, 1);

    await assert.rejects(
      claimItems.reorder(draft.id, { items: [{ id: a.id, displayOrder: 0 }] }, requester, "claim-reorder-incomplete"),
      /exactly once/,
    );

    const reordered = (await claimItems.reorder(
      draft.id,
      { items: [{ id: b.id, displayOrder: 0 }, { id: a.id, displayOrder: 1 }] },
      requester,
      "claim-reorder",
    )) as Array<{ id: string }>;
    assert.deepEqual(reordered.map((row) => row.id), [b.id, a.id]);
  } finally {
    await db.onModuleDestroy();
  }
});

test("claim item department and project must be active", async () => {
  const db = new Postgres();
  const requests = new PaymentRequestService(db);
  const claimItems = new ClaimItemService(db, requests);
  try {
    const draft = await requests.initiate(requester, "claim-invalid-init");
    await assert.rejects(
      claimItems.create(
        draft.id,
        { category: "Travel", departmentId: randomUUID(), currency: "MYR", amount: "10.00" },
        requester,
        "claim-bad-department",
      ),
      /Department is invalid/,
    );
    await assert.rejects(
      claimItems.create(
        draft.id,
        { category: "Travel", departmentId: OPS, projectId: randomUUID(), currency: "MYR", amount: "10.00" },
        requester,
        "claim-bad-project",
      ),
      /Project is invalid/,
    );
  } finally {
    await db.onModuleDestroy();
  }
});
