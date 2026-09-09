"use client";

import "./day1.css";
import { Login } from "@/app/components/auth/Login";
import { NoAccess, SessionProblem } from "@/app/components/auth/SessionStates";
import {
  FinanceDashboard,
  FinanceIntelligenceWorkspace,
  OperationalDrill,
  PaymentHistory,
  ReportingRequestDrill,
} from "@/app/components/dashboard";
import { Brand } from "@/app/components/layout/Brand";
import { Sidebar } from "@/app/components/layout/Sidebar";
import { Editor } from "@/app/components/payment-request/Editor";
import { RequestList } from "@/app/components/payment-request/RequestList";
import { RequesterDashboard } from "@/app/components/payment-request/RequesterDashboard";
import { AuthorityBadge, StageRail } from "@/app/components/shared";
import { usePortalShell } from "@/app/hooks/usePortalShell";
import type { FinanceView, PaymentRequestItem } from "@/app/lib/types";

const financeTitles: Record<FinanceView, string> = {
  "work-queue": "Work Queue",
  approvals: "Approval Inbox",
  "finance-control": "Finance Control",
  "payment-queue": "Payment Queue",
  "payment-history": "Payment History",
  dashboard: "Finance Dashboard",
  ai: "AI Finance Intelligence",
};

const financeDescriptions: Record<FinanceView, string> = {
  "work-queue": "General Finance review within your authorized scope.",
  approvals: "Requests on which you have actionable Approval authority.",
  "finance-control": "The mandatory final controlled gate before payment readiness.",
  "payment-queue": "Only requests you are authorized to record as externally paid.",
  "payment-history": "Immutable historical payment records within your authorized scope.",
  dashboard: "Authoritative financial position and operational attention.",
  ai: "Read-only interpretation grounded in authorized finance evidence.",
};

export default function Home() {
  const portal = usePortalShell();
  const {
    localLogin,
    api,
    authPhase,
    authMessage,
    session,
    workspace,
    financeView,
    requesterHome,
    requesterPaymentOnly,
    items,
    selected,
    notice,
    showPaymentHistory,
    showDashboard,
    approvalPagination,
    dashboardDrill,
    mobileNavOpen,
    identityMode,
    bootstrapSession,
    refresh,
    initiate,
    open,
    signOut,
    goRequester,
    goFinance,
    switchWorkspace,
    login,
    setIdentityMode,
    setApprovalPage,
    setDashboardDrill,
    setShowDashboard,
    setShowPaymentHistory,
    setSelected,
    setMobileNavOpen,
    closeSelected,
    backLabel,
  } = portal;

  if (authPhase === "login")
    return (
      <Login
        local={localLogin}
        message={authMessage}
        onMode={setIdentityMode}
        onLogin={login}
        onRetry={() => void bootstrapSession("/")}
      />
    );

  if (authPhase === "checking")
    return (
      <main className="portalLoading" aria-live="polite">
        <Brand />
        <span className="sessionSpinner" aria-hidden="true" />
        <h1>Checking your session…</h1>
        <p>Confirming your identity and authorized workspace.</p>
      </main>
    );

  if (authPhase === "error")
    return (
      <SessionProblem
        message={authMessage}
        retry={() => void bootstrapSession(window.location.pathname)}
      />
    );

  if (authPhase === "no-access" || !session || !workspace)
    return <NoAccess session={session} signOut={signOut} />;

  const navTitle =
    workspace === "requester"
      ? requesterHome
        ? "Requester Dashboard"
        : requesterPaymentOnly
          ? "Payment Status"
          : "My Requests"
      : financeTitles[financeView];

  const pageTitle = selected
    ? selected.ticketNumber ||
      (selected.status === "DRAFT" ? "Draft request" : "Payment request")
    : navTitle;

  const pageSubtitle =
    workspace === "requester"
      ? "Track your requests, required actions, and payment progress."
      : financeDescriptions[financeView];

  return (
    <main className="appShell">
      <Sidebar
        session={session}
        workspace={workspace}
        financeView={financeView}
        requesterHome={requesterHome}
        requesterPaymentOnly={requesterPaymentOnly}
        selected={Boolean(selected)}
        mobileNavOpen={mobileNavOpen}
        pageTitle={pageTitle}
        onNavigate={{
          goRequester,
          goFinance,
          initiate: () => void initiate(),
          switchWorkspace,
        }}
        signOut={signOut}
        onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
      />

      <section className="workspace">
        {!selected && (
          <header>
            <div>
              <small>AIMS · PAYMENT & FINANCE CONTROL</small>
              <h1>{pageTitle}</h1>
              <p className="pageSubtitle">{pageSubtitle}</p>
            </div>
            {workspace === "requester" && (
              <button className="primary" onClick={() => void initiate()}>
                ＋ New request
              </button>
            )}
            {workspace === "finance" && (
              <div className="headerActions">
                {session.capabilities.financeAnalysis && (
                  <button className="secondary" onClick={() => goFinance("work-queue")}>
                    Work queue
                  </button>
                )}
                {(session.capabilities.payment || session.capabilities.reporting) && (
                  <button className="secondary" onClick={() => goFinance("payment-history")}>
                    Payment History
                  </button>
                )}
                {session.capabilities.reporting && (
                  <button className="primary" onClick={() => goFinance("dashboard")}>
                    Finance Dashboard
                  </button>
                )}
              </div>
            )}
          </header>
        )}

        {workspace === "finance" && selected && <StageRail currentStatus={selected.status} />}

        {notice && (
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}

        {workspace === "finance" && financeView === "payment-queue" && !selected && (
          <p className="controlNotice">
            <AuthorityBadge label="Payment recording authority">PAYMENT RECORDING</AuthorityBadge>
            <span>
              AIMS records externally executed payments. AIMS does not execute bank transfers.
            </span>
          </p>
        )}

        {workspace === "requester" && requesterHome && !selected ? (
          <RequesterDashboard
            api={api}
            open={open}
            newRequest={() => void initiate()}
            viewAll={() => goRequester(false)}
          />
        ) : financeView === "ai" && workspace === "finance" && session.capabilities.reporting ? (
          <FinanceIntelligenceWorkspace api={api} />
        ) : showDashboard && workspace === "finance" && session.capabilities.reporting ? (
          <FinanceDashboard
            api={api}
            onDrill={(drill) => {
              setDashboardDrill(drill);
              setShowDashboard(false);
              setShowPaymentHistory(drill.view === "PAYMENT_HISTORY");
            }}
          />
        ) : showPaymentHistory &&
          workspace === "finance" &&
          (session.capabilities.payment || session.capabilities.reporting) ? (
          <PaymentHistory
            api={api}
            initialFilters={
              dashboardDrill?.view === "PAYMENT_HISTORY" ? dashboardDrill.filters : {}
            }
          />
        ) : dashboardDrill?.view === "REPORTING_REQUESTS" ? (
          <ReportingRequestDrill
            api={api}
            drill={dashboardDrill}
            back={() => setDashboardDrill(null)}
          />
        ) : dashboardDrill?.view === "FINANCE_CONTROL" ||
          dashboardDrill?.view === "PAYMENT_QUEUE" ? (
          <OperationalDrill
            api={api}
            drill={dashboardDrill}
            open={open}
            back={() => setDashboardDrill(null)}
          />
        ) : selected ? (
          <Editor
            item={selected}
            user={session.user.subject}
            identityHeader={identityMode === "COMPETITION" ? session.user.subject : null}
            requesterView={workspace === "requester"}
            api={api}
            backLabel={backLabel}
            changed={async () => {
              if (workspace === "requester") await open(selected.id);
              else
                setSelected(
                  (await api(`/payment-requests/${selected.id}`)) as PaymentRequestItem
                );
              await refresh();
            }}
            back={closeSelected}
          />
        ) : (
          <>
            <RequestList
              key={
                workspace === "requester"
                  ? requesterPaymentOnly
                    ? "requester-payment"
                    : "requester-all"
                  : `finance-${financeView}`
              }
              items={
                workspace === "requester" && requesterPaymentOnly
                  ? items.filter(
                      (item) => item.status === "READY_FOR_PAYMENT" || item.status === "PAID"
                    )
                  : items
              }
              open={open}
              empty={() => void initiate()}
              canCreate={workspace === "requester" && !requesterPaymentOnly}
              requesterView={workspace === "requester"}
              paymentOnly={workspace === "requester" && requesterPaymentOnly}
              api={workspace === "requester" ? api : undefined}
              financeView={workspace === "finance" ? financeView : undefined}
            />
            {workspace === "finance" && session.capabilities.approval && approvalPagination && (
              <nav className="pagination" aria-label="Approval inbox pages">
                <button
                  aria-label="Previous approval page"
                  disabled={!approvalPagination.hasPreviousPage}
                  onClick={() => setApprovalPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </button>
                <span>
                  Page {approvalPagination.page} of {Math.max(1, approvalPagination.totalPages)} ·{" "}
                  {approvalPagination.total} eligible approvals
                </span>
                <button
                  aria-label="Next approval page"
                  disabled={!approvalPagination.hasNextPage}
                  onClick={() => setApprovalPage((page) => page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  );
}
