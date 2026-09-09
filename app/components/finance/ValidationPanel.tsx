"use client";

import { useCallback, useEffect, useState } from "react";
import type { PaymentRequestItem, PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function ValidationPanel({
  item,
  user,
  api,
  changed,
}: {
  item: PaymentRequestItem;
  user: string;
  api: PortalApi;
  changed: () => Promise<void>;
}) {
  type ValidationView = {
    current?: {
      source: string;
      status: string;
      overall_result?: string;
      confidence?: string;
      failure_code?: string;
    };
    findings?: Array<{
      id: string;
      code: string;
      check_status: string;
      severity: string;
      explanation: string;
      evidence: unknown[];
    }>;
    extractions?: Array<{ id: string; extraction: Record<string, unknown> }>;
    clarifications?: Array<{
      id: string;
      reason: string;
      required_response?: string;
      status: string;
    }>;
  };
  const [data, setData] = useState<ValidationView>({});
  const [remarks, setRemarks] = useState(""),
    [response, setResponse] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(
    async () =>
      setData(
        (await api(
          `/payment-requests/${item.id}/validation`,
        )) as ValidationView,
      ),
    [api, item.id],
  );
  useEffect(() => {
    let active = true;
    void api(`/payment-requests/${item.id}/validation`)
      .then((value) => {
        if (active) setData(value as ValidationView);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api, item.id]);
  async function run(work: () => Promise<void>) {
    setNotice("");
    try {
      await work();
      await load();
      await changed();
    } catch (error) {
      setNotice(msg(error));
    }
  }
  const open = data.clarifications?.find((value) => value.status === "OPEN");
  const finalize = (overallResult: "PASS" | "CLARIFICATION_REQUIRED") =>
    run(async () => {
      await api(`/payment-requests/${item.id}/validation/manual`, {
        method: "POST",
        body: JSON.stringify({
          overallResult,
          remarks,
          requiredResponse:
            overallResult === "CLARIFICATION_REQUIRED" ? remarks : undefined,
          findings:
            overallResult === "PASS"
              ? []
              : [
                  {
                    code: "MISSING_INFORMATION",
                    status: "FAIL",
                    severity: "MEDIUM",
                    explanation: remarks,
                  },
                ],
        }),
      });
    });
  return (
    <section className="validationPanel">
      <header>
        <div>
          <small>03 · VALIDATION</small>
          <h3>Document & request validation</h3>
        </div>
        <span>
          {data.current?.overall_result ??
            data.current?.status ??
            "NOT STARTED"}
        </span>
      </header>
      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
      {user === "demo.finance" && item.status === "SUBMITTED" && (
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              await api(`/payment-requests/${item.id}/validation`, {
                method: "POST",
                body: "{}",
              });
            })
          }
        >
          Start validation
        </button>
      )}
      {data.current && (
        <div className="validationMeta">
          <b>{data.current.source}</b>
          <span>{data.current.status}</span>
          {data.current.confidence && (
            <span>
              Confidence {Math.round(Number(data.current.confidence) * 100)}%
            </span>
          )}
          {data.current.failure_code && (
            <span>AI unavailable · manual fallback ready</span>
          )}
        </div>
      )}
      {data.extractions?.map((value) => (
        <section className="extractedFacts" key={value.id} aria-label="Extracted document information">
          <small>EXTRACTED INFORMATION</small>
          <dl>{Object.entries(value.extraction).slice(0,8).map(([key,fact])=><div key={key}><dt>{key.replaceAll("_"," ")}</dt><dd>{fact===null||fact===undefined?"Not found":typeof fact==="object"?"Structured evidence available":String(fact)}</dd></div>)}</dl>
        </section>
      ))}
      {data.findings?.map((value) => (
        <article key={value.id}>
          <b>{value.code}</b>
          <i>
            {value.check_status} · {value.severity}
          </i>
          <p>{value.explanation}</p>
          <small>{value.evidence.length} evidence reference(s)</small>
        </article>
      ))}
      {user === "demo.finance" &&
        item.status === "VALIDATING" &&
        data.current?.status !== "COMPLETED" && (
          <div className="manualReview">
            <textarea
              placeholder="Validator remarks and evidence summary"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
            <button onClick={() => finalize("PASS")}>Confirm PASS</button>
            <button onClick={() => finalize("CLARIFICATION_REQUIRED")}>
              Request clarification
            </button>
          </div>
        )}
      {user === "demo.requester" &&
        item.status === "NEEDS_CLARIFICATION" &&
        open && (
          <div className="manualReview">
            <p>
              <b>Clarification required</b>
              <br />
              {open.reason}
              <br />
              <small>{open.required_response}</small>
            </p>
            <textarea
              placeholder="Your response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
            />
            <button
              onClick={() =>
                run(async () => {
                  await api(
                    `/payment-requests/${item.id}/clarifications/${open.id}/respond`,
                    { method: "POST", body: JSON.stringify({ response }) },
                  );
                })
              }
            >
              Respond and resubmit
            </button>
          </div>
        )}
      {data.current?.overall_result === "PASS" && (
        <p className="readyMarker">
          Validation complete · Ready for Day 3 Finance Context. No automatic
          transition was performed.
        </p>
      )}
    </section>
  );
}
