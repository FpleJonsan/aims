"use client";

import { useEffect, useState } from "react";
import { API_BASE_URL } from "@/app/lib/api-client";
import type { PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export type PaymentRow = {
  id: string;
  ticketNumber: string;
  paymentDate: string;
  payee: string;
  departmentName: string;
  category: string;
  purpose: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  bankReference: string;
  status: string;
  recordedByName: string;
  recordedAt: string;
  approvalSource?: string;
  financeControlStatus?: string;
  commitmentStatus?: string;
  ledgerEntryId?: string;
};

export function PaymentHistory({ api, initialFilters = {} }: { api: PortalApi; initialFilters?: Record<string,string> }) {
  const [filters, setFilters] = useState({
    search: "",
    departmentId: "",
    category: "",
    dateFrom: "",
    dateTo: "",
    status: "PAID",
    page: "1", ...initialFilters,
  });
  const [rows, setRows] = useState<PaymentRow[]>([]),
    [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<PaymentRow | null>(null),
    [notice, setNotice] = useState("");
  const query = new URLSearchParams(
    Object.entries(filters).filter(([, value]) => value),
  ).toString();
  useEffect(() => {
    let active = true;
    void api(`/payments?${query}`)
      .then((value) => {
        if (!active) return;
        const result = value as { items: PaymentRow[]; total: number };
        setRows(result.items);
        setTotal(result.total);
      })
      .catch((error) => {
        if (active) setNotice(msg(error));
      });
    return () => {
      active = false;
    };
  }, [api, query]);
  async function open(id: string) {
    try {
      setDetail((await api(`/payments/${id}`)) as PaymentRow);
    } catch (error) {
      setNotice(msg(error));
    }
  }
  async function exportCsv() {
    const response = await fetch(`${API_BASE_URL}/payments/export?${query}`, {
      credentials:"include",
    });
    if (!response.ok) {
      setNotice("Payment export was denied.");
      return;
    }
    const url = URL.createObjectURL(await response.blob()),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aims-payments-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const field = (name: keyof typeof filters, value: string) =>
    setFilters((x) => ({
      ...x,
      [name]: value,
      page: name === "page" ? value : "1",
    }));
  if (detail)
    return (
      <section className="card paymentHistory">
        <button className="back" onClick={() => setDetail(null)}>
          ← Payment History
        </button>
        <header>
          <div>
            <small>10 · PAYMENT RECORD / HISTORY</small>
            <h2>{detail.ticketNumber}</h2>
          </div>
          <i className="paid">PAID</i>
        </header>
        <div className="paymentDetail">
          <h3>Payment</h3>
          <p>
            {detail.paymentDate?.slice(0, 10)} · {detail.currency}{" "}
            {detail.amount} · {detail.paymentMethod}
          </p>
          <p>Bank reference · {detail.bankReference}</p>
          <a
            href={`${API_BASE_URL}/payments/${detail.id}/slip`}
            onClick={(e) => {
              e.preventDefault();
              void fetch(`${API_BASE_URL}/payments/${detail.id}/slip`, {
                credentials:"include",
              }).then(async (r) => {
                if (!r.ok) throw Error("Slip access denied");
                const u = URL.createObjectURL(await r.blob());
                window.open(u, "_blank");
              });
            }}
          >
            Open secured payment slip
          </a>
          <h3>Request</h3>
          <p>
            {detail.payee} · {detail.departmentName} · {detail.category}
          </p>
          <p>{detail.purpose}</p>
          <h3>Authorization & control</h3>
          <p>Approval · {detail.approvalSource ?? "Approved"}</p>
          <p>Final Finance Control · {detail.financeControlStatus}</p>
          <h3>Financial posting</h3>
          <p>Commitment · {detail.commitmentStatus}</p>
          <p>Actual ledger · {detail.ledgerEntryId}</p>
          <h3>Audit</h3>
          <p>
            Recorded by {detail.recordedByName} at {detail.recordedAt}
          </p>
        </div>
      </section>
    );
  return (
    <section className="card paymentHistory">
      <header>
        <div>
          <small>10 · PAYMENT RECORD / HISTORY</small>
          <h2>Payment History</h2>
        </div>
        <button className="primary" onClick={() => void exportCsv()}>
          Export CSV
        </button>
      </header>
      {notice && <p className="notice">{notice}</p>}
      <div className="historyFilters">
        <input
          aria-label="Search ticket, payee or bank reference"
          placeholder="Ticket, payee or bank reference"
          value={filters.search}
          onChange={(e) => field("search", e.target.value)}
        />
        <input
          aria-label="Department ID"
          placeholder="Department ID"
          value={filters.departmentId}
          onChange={(e) => field("departmentId", e.target.value)}
        />
        <input
          aria-label="Category"
          placeholder="Category"
          value={filters.category}
          onChange={(e) => field("category", e.target.value)}
        />
        <input
          aria-label="From date"
          type="date"
          value={filters.dateFrom}
          onChange={(e) => field("dateFrom", e.target.value)}
        />
        <input
          aria-label="To date"
          type="date"
          value={filters.dateTo}
          onChange={(e) => field("dateTo", e.target.value)}
        />
        <select
          aria-label="Payment status"
          value={filters.status}
          onChange={(e) => field("status", e.target.value)}
        >
          <option value="PAID">PAID</option>
        </select>
      </div>
      <div className="table">
        {rows.map((row,index) => (
          <button key={`${row.id}-${index}`} onClick={() => void open(row.id)}>
            <span className="ticket">{row.ticketNumber}</span>
            <span>
              <b>{row.payee}</b>
              <small>
                {row.departmentName} · {row.category} · {row.purpose}
              </small>
            </span>
            <span>
              {row.currency} {row.amount}
              <small>
                {row.paymentDate?.slice(0, 10)} · {row.paymentMethod}
              </small>
            </span>
            <span>
              {row.recordedByName}
              <small>{row.recordedAt}</small>
            </span>
            <i className="paid">{row.status}</i>
            <strong>Detail →</strong>
          </button>
        ))}
      </div>
      <footer className="pagination">
        <span>{total} records</span>
        <button
          disabled={filters.page === "1"}
          onClick={() =>
            field("page", String(Math.max(1, Number(filters.page) - 1)))
          }
        >
          Previous
        </button>
        <button
          disabled={Number(filters.page) * 25 >= total}
          onClick={() => field("page", String(Number(filters.page) + 1))}
        >
          Next
        </button>
      </footer>
    </section>
  );
}
