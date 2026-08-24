"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./day1.css";

const API = process.env.NEXT_PUBLIC_AIMS_API_URL ?? "http://localhost:3001";
const stages = [
  "Request Initiation",
  "Request Capture",
  "Validation",
  "Finance Context",
  "Financial Risk Analysis",
  "Policy & Decision",
  "Approval",
  "Final Finance Control",
  "Payment Processing",
  "Payment Record / History",
  "Finance Dashboard",
  "AI Finance Intelligence",
];
type Item = {
  id: string;
  ticketNumber: string | null;
  status: "DRAFT" | "SUBMITTED" | "VALIDATING" | "NEEDS_CLARIFICATION";
  payee: string | null;
  purpose: string | null;
  category: string | null;
  amount: string | null;
  currency: string | null;
  departmentId: string;
  dueDate: string | null;
  paymentMethod: string | null;
  paymentDetails: string | null;
  remark: string | null;
  documents?: Array<{
    id: string;
    original_filename: string;
    size_bytes: string;
    version: number;
  }>;
  audit?: Array<{ id: string; action: string; occurred_at: string }>;
};
type Api = (path: string, init?: RequestInit) => Promise<unknown>;

export default function Home() {
  const [user, setUser] = useState<string | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState<Item | null>(null),
    [notice, setNotice] = useState("");
  const api = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      if (!user) throw Error("Sign in required");
      const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          "x-aims-user": user,
          ...(init?.body instanceof FormData
            ? {}
            : { "content-type": "application/json" }),
          ...init?.headers,
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string | string[];
      };
      if (!response.ok)
        throw Error(
          Array.isArray(data.message)
            ? data.message.join(", ")
            : (data.message ?? "Request failed"),
        );
      return data;
    },
    [user],
  );
  const refresh = useCallback(async () => {
    if (user)
      setItems(
        ((await api("/payment-requests?pageSize=50")) as { items: Item[] })
          .items,
      );
  }, [api, user]);
  useEffect(() => {
    let active = true;
    void api("/payment-requests?pageSize=50")
      .then((data) => {
        if (active) setItems((data as { items: Item[] }).items);
      })
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [api, user]);
  async function initiate() {
    try {
      const item = (await api("/payment-requests", {
        method: "POST",
        body: "{}",
      })) as Item;
      setSelected(item);
      await refresh();
    } catch (e) {
      setNotice(msg(e));
    }
  }
  async function open(id: string) {
    try {
      setSelected((await api(`/payment-requests/${id}`)) as Item);
    } catch (e) {
      setNotice(msg(e));
    }
  }
  if (!user) return <Login onLogin={setUser} />;
  return (
    <main className="appShell">
      <aside className="sideNav">
        <Brand />
        <nav>
          <b>▦ Requests</b>
          <span>
            ◫ Validation <i>Active</i>
          </span>
          <span>
            ◌ Finance <i>Future</i>
          </span>
        </nav>
        <button onClick={() => setUser(null)}>Sign out</button>
      </aside>
      <section className="workspace">
        <header>
          <div>
            <small>DAY 2 · VALIDATION</small>
            <h1>Payment requests</h1>
          </div>
          {user === "demo.requester" && (
            <button className="primary" onClick={initiate}>
              ＋ New request
            </button>
          )}
        </header>
        <div className="stageRail">
          {stages.map((s, i) => (
            <div className={i < 3 ? "available" : "future"} key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{s}</b>
              <small>{i < 3 ? "Available" : "Not started"}</small>
            </div>
          ))}
        </div>
        {notice && <p className="notice">{notice}</p>}
        {selected ? (
          <Editor
            item={selected}
            user={user}
            api={api}
            changed={async () => {
              setSelected(
                (await api(`/payment-requests/${selected.id}`)) as Item,
              );
              await refresh();
            }}
            back={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <List
            items={items}
            open={open}
            empty={initiate}
            canCreate={user === "demo.requester"}
          />
        )}
      </section>
    </main>
  );
}

function Login({ onLogin }: { onLogin: (id: string) => void }) {
  return (
    <main className="login">
      <section>
        <div className="loginBrand">A</div>
        <p>AIMAZING INTELLIGENT MANAGEMENT SYSTEM</p>
        <h1>
          Payment control,
          <br />
          <em>with accountability.</em>
        </h1>
        <p className="copy">
          A secure local identity adapter provides the Day 1 request workflow.
          Production requires a trusted identity proxy.
        </p>
        <div>
          <button onClick={() => onLogin("demo.requester")}>
            Continue as requester →
          </button>
          <button className="secondary" onClick={() => onLogin("demo.finance")}>
            View as finance
          </button>
        </div>
        <small>
          LOCAL DEVELOPMENT IDENTITIES · NO PASSWORDS OR TOKENS STORED
        </small>
      </section>
      <aside>
        <p>DAY 1 SCOPE</p>
        {[
          "Authenticated shell",
          "Request initiation",
          "Request capture",
          "Document foundation",
          "Submit to SUBMITTED",
          "Audit history",
        ].map((x, i) => (
          <div key={x}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <b>{x}</b>
          </div>
        ))}
        <footer>Validation and all later stages remain inactive.</footer>
      </aside>
    </main>
  );
}
function Brand() {
  return (
    <div className="brand">
      <span>A</span>
      <div>
        <b>AIMS</b>
        <small>Finance Control</small>
      </div>
    </div>
  );
}
function List({
  items,
  open,
  empty,
  canCreate,
}: {
  items: Item[];
  open: (id: string) => void;
  empty: () => void;
  canCreate: boolean;
}) {
  return (
    <section className="card">
      <header>
        <div>
          <small>REQUEST REGISTER</small>
          <h2>Current requests</h2>
        </div>
        <span>{items.length} records</span>
      </header>
      {items.length ? (
        <div className="table">
          {items.map((x) => (
            <button key={x.id} onClick={() => open(x.id)}>
              <span className="ticket">
                {x.ticketNumber ?? "Draft · no ticket"}
              </span>
              <span>
                <b>{x.payee ?? "Untitled request"}</b>
                <small>{x.purpose ?? "Capture not completed"}</small>
              </span>
              <span>{x.amount ? `${x.currency} ${x.amount}` : "—"}</span>
              <i className={x.status.toLowerCase()}>{x.status}</i>
              <strong>Open →</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>No payment requests yet</h3>
          <p>Initiate a request to create a controlled draft context.</p>
          {canCreate && (
            <button className="primary" onClick={empty}>
              Start first request
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Editor({
  item,
  user,
  api,
  changed,
  back,
}: {
  item: Item;
  user: string;
  api: Api;
  changed: () => Promise<void>;
  back: () => void;
}) {
  const [form, setForm] = useState(item),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const draft = item.status === "DRAFT";
  const field = (name: keyof Item, value: string) =>
    setForm((x) => ({ ...x, [name]: value }));
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (e) {
      setNotice(msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    await act(async () => {
      const {
        payee,
        purpose,
        category,
        amount,
        currency,
        dueDate,
        paymentMethod,
        paymentDetails,
        remark,
      } = form;
      await api(`/payment-requests/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          payee,
          purpose,
          category,
          amount,
          currency,
          dueDate,
          paymentMethod,
          paymentDetails,
          remark,
        }),
      });
      await changed();
      setNotice("Draft saved.");
    });
  }
  async function submit() {
    if (confirm("Submit this request as a controlled snapshot?"))
      await act(async () => {
        const x = (await api(`/payment-requests/${item.id}/submit`, {
          method: "POST",
          body: "{}",
        })) as Item;
        await changed();
        setNotice(`Submitted as ${x.ticketNumber}.`);
      });
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const target = e.currentTarget;
    await act(async () => {
      await api(`/payment-requests/${item.id}/documents`, {
        method: "POST",
        body: new FormData(target),
      });
      await changed();
      target.reset();
      setNotice("Document attached.");
    });
  }
  async function remove(id: string) {
    await act(async () => {
      await api(`/payment-requests/${item.id}/documents/${id}`, {
        method: "DELETE",
      });
      await changed();
    });
  }
  return (
    <section className="editor">
      <button className="back" onClick={back}>
        ← Request register
      </button>
      <header>
        <div>
          <small>{item.ticketNumber ?? "REQUEST INITIATION"}</small>
          <h2>{item.payee || "New payment request"}</h2>
        </div>
        <i className={item.status.toLowerCase()}>{item.status}</i>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {item.status !== "DRAFT" && (
        <ValidationPanel item={item} user={user} api={api} changed={changed} />
      )}
      <div className="editorGrid">
        <form className="capture" onSubmit={save}>
          <div className="formTitle">
            <span>02</span>
            <p>
              <b>Request Capture</b>
              <small>
                Capture facts only. Business Validation starts on Day 2.
              </small>
            </p>
          </div>
          <div className="fields">
            <Field
              label="Payee"
              value={form.payee}
              set={(v) => field("payee", v)}
              disabled={!draft}
            />
            <Field
              label="Category"
              value={form.category}
              set={(v) => field("category", v)}
              disabled={!draft}
            />
            <Field
              label="Purpose"
              value={form.purpose}
              set={(v) => field("purpose", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Amount"
              value={form.amount}
              set={(v) => field("amount", v)}
              disabled={!draft}
            />
            <label>
              Currency
              <select
                value={form.currency ?? ""}
                onChange={(e) => field("currency", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                {["MYR", "USD", "SGD", "EUR", "GBP"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => field("dueDate", e.target.value)}
                disabled={!draft}
              />
            </label>
            <label>
              Payment method
              <select
                value={form.paymentMethod ?? ""}
                onChange={(e) => field("paymentMethod", e.target.value)}
                disabled={!draft}
              >
                <option value="">Select</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CARD">Corporate card</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
            <Field
              label="Payment details"
              value={form.paymentDetails}
              set={(v) => field("paymentDetails", v)}
              disabled={!draft}
              wide
            />
            <Field
              label="Remark"
              value={form.remark}
              set={(v) => field("remark", v)}
              disabled={!draft}
              wide
            />
          </div>
          {draft && (
            <footer>
              <button disabled={busy}>Save draft</button>
              <button
                type="button"
                className="primary"
                onClick={submit}
                disabled={busy}
              >
                Submit request →
              </button>
            </footer>
          )}
        </form>
        <aside className="right">
          <section>
            <small>SUPPORTING DOCUMENTS</small>
            {(draft || item.status === "NEEDS_CLARIFICATION") && (
              <form className="upload" onSubmit={upload}>
                <input
                  name="file"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  required
                />
                <input
                  name="documentType"
                  placeholder="Document type (optional)"
                />
                <button disabled={busy}>Upload document</button>
                <small>PDF, JPG or PNG · maximum 10 MB</small>
              </form>
            )}
            {item.documents?.map((d) => (
              <div className="document" key={d.id}>
                <span>DOC</span>
                <p>
                  <b>{d.original_filename}</b>
                  <small>
                    v{d.version} · {Math.ceil(Number(d.size_bytes) / 1024)} KB
                  </small>
                </p>
                {draft && <button onClick={() => remove(d.id)}>×</button>}
              </div>
            ))}
            {!item.documents?.length && (
              <p className="muted">No documents attached.</p>
            )}
          </section>
          <section>
            <small>ACTIVITY</small>
            {item.audit?.map((a) => (
              <div className="activity" key={a.id}>
                <i />
                <p>
                  <b>{a.action.replaceAll("_", " ")}</b>
                  <small>{new Date(a.occurred_at).toLocaleString()}</small>
                </p>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </section>
  );
}

function ValidationPanel({ item, user, api, changed }: { item: Item; user: string; api: Api; changed: () => Promise<void> }) {
  type ValidationView = { current?: { source: string; status: string; overall_result?: string; confidence?: string; failure_code?: string }; findings?: Array<{ id: string; code: string; check_status: string; severity: string; explanation: string; evidence: unknown[] }>; extractions?: Array<{ id: string; extraction: Record<string, unknown> }>; clarifications?: Array<{ id: string; reason: string; required_response?: string; status: string }> };
  const [data, setData] = useState<ValidationView>({});
  const [remarks, setRemarks] = useState(""), [response, setResponse] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => setData(await api(`/payment-requests/${item.id}/validation`) as ValidationView), [api, item.id]);
  useEffect(() => { let active = true; void api(`/payment-requests/${item.id}/validation`).then(value => { if (active) setData(value as ValidationView); }).catch(() => undefined); return () => { active = false; }; }, [api, item.id]);
  async function run(work: () => Promise<void>) { setNotice(""); try { await work(); await load(); await changed(); } catch (error) { setNotice(msg(error)); } }
  const open = data.clarifications?.find(value => value.status === "OPEN");
  const finalize = (overallResult: "PASS" | "CLARIFICATION_REQUIRED") => run(async () => { await api(`/payment-requests/${item.id}/validation/manual`, { method: "POST", body: JSON.stringify({ overallResult, remarks, requiredResponse: overallResult === "CLARIFICATION_REQUIRED" ? remarks : undefined, findings: overallResult === "PASS" ? [] : [{ code: "MISSING_INFORMATION", status: "FAIL", severity: "MEDIUM", explanation: remarks }] }) }); });
  return <section className="validationPanel">
    <header><div><small>03 · VALIDATION</small><h3>Document & request validation</h3></div><span>{data.current?.overall_result ?? data.current?.status ?? "NOT STARTED"}</span></header>
    {notice && <p className="notice">{notice}</p>}
    {user === "demo.finance" && item.status === "SUBMITTED" && <button className="primary" onClick={() => run(async () => { await api(`/payment-requests/${item.id}/validation`, { method: "POST", body: "{}" }); })}>Start validation</button>}
    {data.current && <div className="validationMeta"><b>{data.current.source}</b><span>{data.current.status}</span>{data.current.confidence && <span>Confidence {Math.round(Number(data.current.confidence) * 100)}%</span>}{data.current.failure_code && <span>AI unavailable · manual fallback ready</span>}</div>}
    {data.extractions?.map(value => <pre key={value.id}>{JSON.stringify(value.extraction, null, 2)}</pre>)}
    {data.findings?.map(value => <article key={value.id}><b>{value.code}</b><i>{value.check_status} · {value.severity}</i><p>{value.explanation}</p><small>{value.evidence.length} evidence reference(s)</small></article>)}
    {user === "demo.finance" && item.status === "VALIDATING" && data.current?.status !== "COMPLETED" && <div className="manualReview"><textarea placeholder="Validator remarks and evidence summary" value={remarks} onChange={event => setRemarks(event.target.value)} /><button onClick={() => finalize("PASS")}>Confirm PASS</button><button onClick={() => finalize("CLARIFICATION_REQUIRED")}>Request clarification</button></div>}
    {user === "demo.requester" && item.status === "NEEDS_CLARIFICATION" && open && <div className="manualReview"><p><b>Clarification required</b><br />{open.reason}<br /><small>{open.required_response}</small></p><textarea placeholder="Your response" value={response} onChange={event => setResponse(event.target.value)} /><button onClick={() => run(async () => { await api(`/payment-requests/${item.id}/clarifications/${open.id}/respond`, { method: "POST", body: JSON.stringify({ response }) }); })}>Respond and resubmit</button></div>}
    {data.current?.overall_result === "PASS" && <p className="readyMarker">Validation complete · Ready for Day 3 Finance Context. No automatic transition was performed.</p>}
  </section>;
}
function Field({
  label,
  value,
  set,
  disabled,
  wide,
}: {
  label: string;
  value: string | null;
  set: (v: string) => void;
  disabled: boolean;
  wide?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      {label}
      {wide ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
        />
      ) : (
        <input
          value={value ?? ""}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
        />
      )}
    </label>
  );
}
function msg(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
