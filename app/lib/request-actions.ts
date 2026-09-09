import type { PortalApi } from "@/app/lib/types";

const DRAFT_DISCARD_REASON = "Draft discarded by requester";

/** Cancel a DRAFT payment request via the controlled cancellation endpoint. */
export async function discardDraftRequest(api: PortalApi, requestId: string) {
  await api(`/payment-requests/${requestId}/cancel`, {
    method: "POST",
    body: JSON.stringify({
      reason: DRAFT_DISCARD_REASON,
      commandKey: crypto.randomUUID(),
    }),
  });
}
