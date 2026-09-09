"use client";

import { FormEvent, useState } from "react";
import { AuthorityBadge } from "@/app/components/shared";
import type { IntelligenceAnswer, IntelligenceWatch } from "@/app/lib/dashboard-types";
import type { PortalApi } from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function FinanceIntelligenceWorkspace({ api }: { api: PortalApi }) {
  const [watch, setWatch] = useState<IntelligenceWatch | null>(null);
  const [answer, setAnswer] = useState<IntelligenceAnswer | null>(null);
  const [question, setQuestion] = useState("");
  const [notice, setNotice] = useState("");

  const runWatch = async () => {
    try {
      setNotice("");
      setWatch(
        (await api("/finance-intelligence/watch", {
          method: "POST",
          body: "{}",
        })) as IntelligenceWatch
      );
    } catch (e) {
      setNotice(msg(e));
    }
  };

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setNotice("");
      setAnswer(
        (await api("/finance-intelligence/ask", {
          method: "POST",
          body: JSON.stringify({ question }),
        })) as IntelligenceAnswer
      );
    } catch (error) {
      setNotice(msg(error));
    }
  };

  return (
    <section className="aiWorkspace">
      <header>
        <div>
          <small>AI FINANCE INTELLIGENCE · READ ONLY</small>
          <h2>Interpretation, grounded in authorized evidence</h2>
          <p>
            AI can summarize and explain. It cannot approve, calculate authoritative balances, or
            change workflow state.
          </p>
        </div>
        <AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge>
      </header>
      {notice && (
        <div className="aiDisabled" role="status">
          <b>AI Finance Intelligence is unavailable.</b>
          <span>The deterministic Finance Dashboard remains available.</span>
        </div>
      )}
      <div className="aiWorkspaceGrid">
        <section className="aiPanel">
          <div className="sectionHeading">
            <div>
              <small>FINANCE WATCH</small>
              <h3>Operational interpretation</h3>
            </div>
            <AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge>
          </div>
          <p>
            Generate a bounded, evidence-backed reading of the current authorized finance position.
          </p>
          <button className="aiButton" onClick={() => void runWatch()}>
            Generate Finance Watch
          </button>
          {watch && (
            <article>
              <h4>{String(watch.headline ?? "Finance Watch")}</h4>
              <p>
                {String(
                  watch.summary ??
                    watch.interpretation ??
                    "Interpretation generated from authorized evidence."
                )}
              </p>
            </article>
          )}
        </section>
        <section className="aiPanel">
          <div className="sectionHeading">
            <div>
              <small>ASK AIMS</small>
              <h3>Ask about finance evidence</h3>
            </div>
            <AuthorityBadge ai>AI INTERPRETATION</AuthorityBadge>
          </div>
          <form onSubmit={ask}>
            <label htmlFor="aims-question">Question</label>
            <textarea
              id="aims-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What requires Finance attention?"
              required
            />
            <button className="aiButton">Ask AIMS</button>
          </form>
          {answer && (
            <article>
              <h4>Advisory response</h4>
              <p>
                {String(
                  answer.answer ??
                    answer.response ??
                    "Response generated from authorized evidence."
                )}
              </p>
            </article>
          )}
        </section>
      </div>
      <footer>
        <AuthorityBadge>SYSTEM CALCULATED DATA REMAINS AUTHORITATIVE</AuthorityBadge>
        <span>AI OFF preserves the complete deterministic workflow.</span>
      </footer>
    </section>
  );
}
