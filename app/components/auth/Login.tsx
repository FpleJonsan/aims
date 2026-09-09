"use client";

import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/app/components/layout/Brand";
import { API_BASE_URL } from "@/app/lib/api-client";
import type { IdentityMode, LocalIdentity } from "@/app/lib/types";

interface LoginProps {
  onLogin: (id: string) => void;
  onMode: (mode: IdentityMode) => void;
  local: boolean;
  message: string;
  onRetry: () => void;
}

export function Login({ onLogin, onMode, local, message, onRetry }: LoginProps) {
  const [identities, setIdentities] = useState<LocalIdentity[]>([]);
  const [identityMode, setIdentityMode] = useState<"LOCAL" | "COMPETITION">("LOCAL");
  const [loading, setLoading] = useState(local);
  const [identityError, setIdentityError] = useState("");

  const loadIdentities = useCallback(() => {
    if (!local) return;
    setLoading(true);
    setIdentityError("");
    void fetch(`${API_BASE_URL}/auth/local-identities`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw Error("Local identity service unavailable");
        return response.json() as Promise<{ mode: string; identities: LocalIdentity[] }>;
      })
      .then((result) => {
        const mode = result.mode === "COMPETITION" ? "COMPETITION" : "LOCAL";
        setIdentityMode(mode);
        onMode(mode);
        setIdentities(result.identities);
      })
      .catch(() =>
        setIdentityError(
          "Unable to load available identities. Check that the AIMS API is running."
        )
      )
      .finally(() => setLoading(false));
  }, [local, onMode]);

  useEffect(() => {
    void Promise.resolve().then(loadIdentities);
  }, [loadIdentities]);

  return (
    <main className="login">
      <section className="loginStory">
        <Brand />
        <div className="loginMessage">
          <p>AIMAZING INTELLIGENT MANAGEMENT SYSTEM</p>
          <h1>Payment and finance control you can trust.</h1>
          <p className="copy">
            One controlled workflow for payment requests, validation, approval, final finance
            control, payment records, and authoritative reporting.
          </p>
          <div className="loginAssurances" aria-label="AIMS control principles">
            <span>
              <b>12</b> distinct workflow stages
            </span>
            <span>
              <b>Human</b> approval accountability
            </span>
            <span>
              <b>Deterministic</b> finance controls
            </span>
          </div>
        </div>
        <small>AI is advisory. Finance authority remains deterministic and human-controlled.</small>
      </section>
      <aside className="loginAccess">
        <div className="loginCard">
          <header>
            <span className="loginLock" aria-hidden="true">
              A
            </span>
            <div>
              <small>
                {local
                  ? identityMode === "COMPETITION"
                    ? "COMPETITION ENVIRONMENT"
                    : "LOCAL ENVIRONMENT"
                  : "ORGANIZATION SIGN-IN"}
              </small>
              <h2>{local ? "Welcome to AIMS" : "Sign in to AIMS"}</h2>
            </div>
          </header>
          <p>
            {local
              ? "Select your identity to continue."
              : "AIMS uses your organization’s trusted identity provider. No local or fallback identity selector is available in production."}
          </p>
          {message && (
            <p className="authMessage" role="status" aria-live="polite">
              {message}
            </p>
          )}
          {local ? (
            <>
              {loading ? (
                <div className="identityLoading" aria-live="polite">
                  Loading available identities…
                </div>
              ) : identityError ? (
                <div className="identityError" role="alert">
                  <span>{identityError}</span>
                  <button onClick={loadIdentities}>Retry</button>
                </div>
              ) : (
                <div className="roleChoices" aria-label="Available local identities">
                  {identities.map((identity) => (
                    <button key={identity.subject} onClick={() => onLogin(identity.subject)}>
                      <span className="roleIcon" aria-hidden="true">
                        {identity.persona
                          .split(/\s+/)
                          .map((x) => x[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span>
                        <b>{identity.persona}</b>
                        <small>
                          {identity.displayName} · {identity.department}
                        </small>
                        <small>
                          {identity.workspaces.length
                            ? `${identity.workspaces.join(" + ")} workspace${identity.workspaces.length === 1 ? "" : "s"}`
                            : "No operational workspace"}
                        </small>
                      </span>
                      <strong aria-hidden="true">→</strong>
                    </button>
                  ))}
                </div>
              )}
              <div className="localAccessNote">
                <b>
                  {identityMode === "COMPETITION"
                    ? "Controlled competition access"
                    : "Local authenticated access"}
                </b>
                <span>
                  {identityMode === "COMPETITION"
                    ? "Identity and authority are verified by AIMS. Displayed roles never grant access."
                    : "Identity is established through a server session. Finance authority remains in AIMS."}
                </span>
              </div>
            </>
          ) : (
            <div className="productionAccess">
              <span>Secure identity proxy required</span>
              <button className="primary" onClick={onRetry}>
                Check organization session
              </button>
            </div>
          )}
        </div>
        <footer>Authorized access only · Activity is auditable</footer>
      </aside>
    </main>
  );
}
