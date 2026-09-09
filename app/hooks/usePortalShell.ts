"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalApi } from "@/app/hooks/useApi";
import { API_BASE_URL, readCookie } from "@/app/lib/api-client";
import {
  financeQueueItem,
  paymentQueueItem,
  requesterDetailItem,
  requesterListItem,
} from "@/app/lib/mappers";
import {
  allowedFinanceView,
  defaultFinanceView,
  routeForSession,
  safeInternalPath,
  type FinanceView,
  type Workspace,
} from "@/app/lib/session-ux";
import type {
  AuthPhase,
  DashboardDrill,
  IdentityMode,
  Pagination,
  PaymentRequestItem,
  PortalSession,
} from "@/app/lib/types";
import { msg } from "@/app/lib/utils";

export function usePortalShell() {
  const localLogin = process.env.NODE_ENV !== "production";
  const [user, setUser] = useState<string | null>(null);
  const [identityMode, setIdentityMode] = useState<IdentityMode>("LOCAL");
  const [authPhase, setAuthPhase] = useState<AuthPhase>("checking");
  const [authMessage, setAuthMessage] = useState("");
  const [items, setItems] = useState<PaymentRequestItem[]>([]);
  const [selected, setSelected] = useState<PaymentRequestItem | null>(null);
  const [notice, setNotice] = useState("");
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [session, setSession] = useState<PortalSession | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [financeView, setFinanceView] = useState<FinanceView>("dashboard");
  const [requesterHome, setRequesterHome] = useState(true);
  const [requesterPaymentOnly, setRequesterPaymentOnly] = useState(false);
  const [approvalPage, setApprovalPage] = useState(1);
  const [approvalPagination, setApprovalPagination] = useState<Pagination | null>(null);
  const [dashboardDrill, setDashboardDrill] = useState<DashboardDrill | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const authorizationRefresh = useRef(false);

  const api = usePortalApi({ identityMode, user });

  const clearProtectedState = useCallback(() => {
    setItems([]);
    setSelected(null);
    setApprovalPagination(null);
    setDashboardDrill(null);
    setShowDashboard(false);
    setShowPaymentHistory(false);
  }, []);

  const applySession = useCallback((next: PortalSession, requestedPath: string, message = "") => {
    setSession(next);
    const stored = window.localStorage.getItem("aims.workspace");
    const preferred = stored === "requester" || stored === "finance" ? stored : null;
    const destination = routeForSession(next, requestedPath, preferred);
    setWorkspace(destination.workspace);
    if (destination.financeView) setFinanceView(destination.financeView);
    setRequesterPaymentOnly(
      destination.workspace === "requester" &&
        destination.path.startsWith("/requester/payment-status")
    );
    setRequesterHome(
      destination.workspace === "requester" &&
        (destination.path === "/requester" || destination.path === "/requester/")
    );
    setShowDashboard(
      destination.workspace === "finance" && destination.financeView === "dashboard"
    );
    setShowPaymentHistory(
      destination.workspace === "finance" && destination.financeView === "payment-history"
    );
    setNotice(message);
    setAuthPhase(destination.workspace ? "ready" : "no-access");
    window.history.replaceState({}, "", destination.path);
  }, []);

  const bootstrapSession = useCallback(
    async (requestedPath: string) => {
      setAuthPhase("checking");
      setAuthMessage("");
      clearProtectedState();
      try {
        const next = (await api("/session")) as PortalSession;
        const savedRedirect = safeInternalPath(window.sessionStorage.getItem("aims.redirect"));
        window.sessionStorage.removeItem("aims.redirect");
        applySession(next, savedRedirect ?? requestedPath);
      } catch (error) {
        const message = msg(error);
        if (
          (error as { status?: number }).status === 401 ||
          message === "Authentication required" ||
          message.includes("Unknown or inactive") ||
          message.includes("Production identity proxy")
        ) {
          setSession(null);
          setWorkspace(null);
          setAuthPhase("login");
          return;
        }
        setSession(null);
        setWorkspace(null);
        setAuthMessage("Unable to verify your AIMS session. Try again.");
        setAuthPhase("error");
      }
    },
    [api, applySession, clearProtectedState]
  );

  const refresh = useCallback(async () => {
    if (!session || !workspace) return;
    if (workspace === "requester") {
      const rows = (await api("/requester/requests?pageSize=50")) as {
        items: Array<Record<string, unknown>>;
      };
      setItems(rows.items.map(requesterListItem));
    } else if (financeView === "approvals") {
      const rows = (await api(`/approvals?page=${approvalPage}&pageSize=25`)) as {
        items: Array<Record<string, unknown>>;
      } & Pagination;
      setApprovalPagination(rows);
      setItems(
        rows.items.map((x) => ({
          id: String(x.payment_request_id),
          ticketNumber: String(x.ticket_number),
          status: "PENDING_APPROVAL" as const,
          payee: String(x.payee),
          purpose: `Current step ${x.sequence} · ${x.required_role}`,
          amount: String(x.amount),
          currency: String(x.currency),
          departmentId: String(x.department_id),
          dueDate: String(x.due_date),
          category: null,
          paymentMethod: null,
          paymentDetails: null,
          remark: null,
          humanFinalRisk: String(x.final_risk),
        }))
      );
    } else {
      const control =
        financeView === "finance-control"
          ? ((await api("/finance-control")) as { items: Array<Record<string, unknown>> }).items
          : [];
      const payment =
        financeView === "payment-queue"
          ? ((await api("/payment-queue")) as { items: Array<Record<string, unknown>> }).items
          : [];
      const work: PaymentRequestItem[] = [];
      if (financeView === "work-queue") {
        for (let page = 1; page <= 100; page += 1) {
          const batch = (
            (await api(`/payment-requests?page=${page}&pageSize=100`)) as {
              items: PaymentRequestItem[];
            }
          ).items;
          work.push(
            ...batch.filter((item) =>
              ["SUBMITTED", "VALIDATING", "NEEDS_CLARIFICATION"].includes(item.status)
            )
          );
          if (batch.length < 100) break;
        }
      }
      setItems(
        [...work, ...control.map(financeQueueItem), ...payment.map(paymentQueueItem)].filter(
          (x, i, a) => a.findIndex((y) => y.id === x.id) === i
        )
      );
    }
  }, [api, session, workspace, approvalPage, financeView]);

  useEffect(() => {
    if (authPhase !== "ready" || !session || !workspace) return;
    let active = true;
    void Promise.resolve()
      .then(refresh)
      .catch((e) => {
        if (active) setNotice(msg(e));
      });
    return () => {
      active = false;
    };
  }, [refresh, authPhase, session, workspace, approvalPage]);

  useEffect(() => {
    void Promise.resolve().then(() =>
      bootstrapSession(window.location.pathname + window.location.search)
    );
  }, [bootstrapSession]);

  useEffect(() => {
    const unauthenticated = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      const current = safeInternalPath(window.location.pathname + window.location.search);
      if (current && current !== "/login")
        window.sessionStorage.setItem("aims.redirect", current);
      clearProtectedState();
      setSession(null);
      setWorkspace(null);
      setUser(null);
      setAuthMessage(
        detail?.message?.includes("inactive")
          ? "Your AIMS account is currently inactive."
          : "Your session has expired. Please sign in again."
      );
      setAuthPhase("login");
      window.history.replaceState({}, "", "/login");
    };
    const forbidden = () => {
      if (authorizationRefresh.current) return;
      authorizationRefresh.current = true;
      clearProtectedState();
      setAuthPhase("checking");
      setNotice("Your access changed. AIMS is refreshing your authorized workspace.");
      void fetch(`${API_BASE_URL}/session`, { credentials: "include" })
        .then(async (response) => {
          if (response.status === 401) {
            window.dispatchEvent(new CustomEvent("aims:unauthenticated"));
            return null;
          }
          if (!response.ok) throw Error("session-refresh-failed");
          return response.json() as Promise<PortalSession>;
        })
        .then((next) => {
          if (!next) return;
          applySession(
            next,
            window.location.pathname,
            "You no longer have access to that feature. Your workspace has been updated."
          );
        })
        .catch(() => {
          setAuthMessage("Unable to verify your AIMS session. Try again.");
          setAuthPhase("error");
        })
        .finally(() => {
          authorizationRefresh.current = false;
        });
    };
    window.addEventListener("aims:unauthenticated", unauthenticated);
    window.addEventListener("aims:forbidden", forbidden);
    return () => {
      window.removeEventListener("aims:unauthenticated", unauthenticated);
      window.removeEventListener("aims:forbidden", forbidden);
    };
  }, [applySession, clearProtectedState]);

  useEffect(() => {
    if (authPhase !== "ready" || workspace !== "requester" || selected) return;
    const match = window.location.pathname.match(/^\/requester\/requests\/([0-9a-f-]{36})$/i);
    if (!match) return;
    let active = true;
    void api(`/requester/requests/${match[1]}`)
      .then((value) => {
        if (active)
          setSelected(
            requesterDetailItem(
              value as {
                request: Record<string, unknown>;
                documents: Array<Record<string, unknown>>;
                activity: Array<Record<string, unknown>>;
                clarifications: Array<Record<string, unknown>>;
                payment: Record<string, unknown> | null;
              }
            )
          );
      })
      .catch((error) => {
        if (active) setNotice(msg(error));
      });
    return () => {
      active = false;
    };
  }, [api, authPhase, workspace, selected]);

  async function initiate() {
    try {
      const item = (await api("/payment-requests", {
        method: "POST",
        body: "{}",
      })) as PaymentRequestItem;
      setSelected(item);
      window.history.pushState({}, "", "/requester/requests/new");
      await refresh();
    } catch (e) {
      setNotice(msg(e));
    }
  }

  async function open(id: string) {
    try {
      if (workspace === "requester") {
        const safe = (await api(`/requester/requests/${id}`)) as {
          request: Record<string, unknown>;
          documents: Array<Record<string, unknown>>;
          activity: Array<Record<string, unknown>>;
          clarifications: Array<Record<string, unknown>>;
          payment: Record<string, unknown> | null;
        };
        setSelected(requesterDetailItem(safe));
        window.history.pushState({}, "", `/requester/requests/${id}`);
      } else {
        setSelected((await api(`/payment-requests/${id}`)) as PaymentRequestItem);
      }
    } catch (e) {
      setNotice(msg(e));
    }
  }

  const signOut = () => {
    if (!localLogin) {
      const providerLogout = process.env.NEXT_PUBLIC_AIMS_LOGOUT_URL;
      if (providerLogout) {
        clearProtectedState();
        setSession(null);
        setWorkspace(null);
        window.location.assign(providerLogout);
        return;
      }
      setNotice(
        "Sign out must be completed through your organization identity provider. No provider logout URL is configured."
      );
      return;
    }
    void fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: { "x-aims-csrf": readCookie("aims_csrf") },
    }).finally(() => {
      clearProtectedState();
      window.localStorage.removeItem("aims.workspace");
      window.sessionStorage.removeItem("aims.redirect");
      setSession(null);
      setWorkspace(null);
      setUser(null);
      setAuthMessage("You have signed out of AIMS.");
      setAuthPhase("login");
      window.history.replaceState({}, "", "/login");
    });
  };

  const goRequester = (home: boolean, paymentOnly = false) => {
    setMobileNavOpen(false);
    setNotice("");
    setSelected(null);
    setRequesterHome(home);
    setRequesterPaymentOnly(paymentOnly);
    window.history.pushState(
      {},
      "",
      home ? "/requester" : paymentOnly ? "/requester/payment-status" : "/requester/requests"
    );
  };

  const closeSelected = () => {
    setSelected(null);
    setNotice("");
    if (workspace === "requester") {
      const path = requesterHome
        ? "/requester"
        : requesterPaymentOnly
          ? "/requester/payment-status"
          : "/requester/requests";
      window.history.pushState({}, "", path);
    } else if (workspace === "finance") {
      window.history.pushState({}, "", `/finance/${financeView}`);
    }
    void refresh();
  };

  const backLabel =
    workspace === "requester"
      ? requesterHome
        ? "← Dashboard"
        : requesterPaymentOnly
          ? "← Payment Status"
          : "← My Requests"
      : "← Request register";

  const goFinance = (view: FinanceView) => {
    if (!session || !allowedFinanceView(session, view)) return;
    setMobileNavOpen(false);
    setNotice("");
    setSelected(null);
    setDashboardDrill(null);
    setFinanceView(view);
    setShowDashboard(view === "dashboard");
    setShowPaymentHistory(view === "payment-history");
    window.history.pushState({}, "", `/finance/${view}`);
  };

  const switchWorkspace = (next: Workspace) => {
    if (!session?.workspaces[next]) return;
    window.localStorage.setItem("aims.workspace", next);
    setWorkspace(next);
    setSelected(null);
    setItems([]);
    setDashboardDrill(null);
    if (next === "requester") {
      setRequesterHome(true);
      setShowDashboard(false);
      setShowPaymentHistory(false);
      window.history.pushState({}, "", "/requester");
    } else {
      const view = defaultFinanceView(session);
      if (view) goFinance(view);
    }
  };

  const login = (identity: string) => {
    setNotice("");
    setAuthMessage("");
    setAuthPhase("checking");
    if (identityMode === "COMPETITION") {
      setUser(identity);
      return;
    }
    void fetch(`${API_BASE_URL}/auth/local-login`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: identity }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        if (!response.ok) throw Error(data.message ?? "Unable to sign in");
        setUser(identity);
      })
      .catch((error) => {
        setAuthMessage(msg(error));
        setAuthPhase("login");
      });
  };

  return {
    localLogin,
    api,
    authPhase,
    authMessage,
    identityMode,
    setIdentityMode,
    session,
    workspace,
    financeView,
    requesterHome,
    requesterPaymentOnly,
    items,
    selected,
    setSelected,
    notice,
    showPaymentHistory,
    showDashboard,
    approvalPagination,
    setApprovalPage,
    dashboardDrill,
    setDashboardDrill,
    setShowDashboard,
    setShowPaymentHistory,
    mobileNavOpen,
    setMobileNavOpen,
    bootstrapSession,
    refresh,
    initiate,
    open,
    signOut,
    goRequester,
    goFinance,
    switchWorkspace,
    login,
    closeSelected,
    backLabel,
  };
}
