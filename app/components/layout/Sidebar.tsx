import type { FinanceView, PortalSession, Workspace } from "@/app/lib/types";
import { Brand } from "./Brand";
import { UserCard } from "./UserCard";

interface SidebarProps {
  session: PortalSession;
  workspace: Workspace;
  financeView: FinanceView;
  requesterHome: boolean;
  requesterPaymentOnly: boolean;
  selected: boolean;
  mobileNavOpen: boolean;
  pageTitle: string;
  onNavigate: {
    goRequester: (home: boolean, paymentOnly?: boolean) => void;
    goFinance: (view: FinanceView) => void;
    initiate: () => void;
    switchWorkspace: (workspace: Workspace) => void;
  };
  signOut: () => void;
  onToggleMobileNav: () => void;
}

export function Sidebar({
  session,
  workspace,
  financeView,
  requesterHome,
  requesterPaymentOnly,
  selected,
  mobileNavOpen,
  pageTitle,
  onNavigate,
  signOut,
  onToggleMobileNav,
}: SidebarProps) {
  const { goRequester, goFinance, initiate, switchWorkspace } = onNavigate;

  const dashboardActive = requesterHome;
  const requestsActive = !requesterHome && !requesterPaymentOnly;
  const paymentActive = requesterPaymentOnly;

  return (
    <aside className="sideNav">
      <Brand />

      <button
        className="mobileNavToggle"
        aria-controls="aims-primary-navigation"
        aria-expanded={mobileNavOpen}
        onClick={onToggleMobileNav}
      >
        <span aria-hidden="true">{mobileNavOpen ? "×" : "☰"}</span>
        <span>{mobileNavOpen ? "Close menu" : pageTitle}</span>
      </button>

      <nav
        id="aims-primary-navigation"
        aria-label="Primary navigation"
        className={`primaryNav${mobileNavOpen ? " mobileOpen" : ""}`}
      >
        {workspace === "requester" ? (
          <>
            <button
              className={dashboardActive ? "active" : ""}
              onClick={() => goRequester(true)}
              aria-current={dashboardActive && !selected ? "page" : undefined}
            >
              <span aria-hidden="true">▦</span>
              Dashboard
            </button>
            <button
              className={requestsActive ? "active" : ""}
              onClick={() => goRequester(false)}
              aria-current={requestsActive && !selected ? "page" : undefined}
            >
              <span aria-hidden="true">☷</span>
              My Requests
            </button>
            <button onClick={() => void initiate()}>
              <span aria-hidden="true">＋</span>
              New Request
            </button>
            <button
              className={paymentActive ? "active" : ""}
              onClick={() => goRequester(false, true)}
              aria-current={paymentActive && !selected ? "page" : undefined}
            >
              <span aria-hidden="true">◷</span>
              Payment Status
            </button>
          </>
        ) : (
          <>
            <small>FINANCE COMMAND CENTER</small>
            {session.capabilities.reporting && (
              <button
                className={financeView === "dashboard" ? "active" : ""}
                onClick={() => goFinance("dashboard")}
                aria-current={financeView === "dashboard" && !selected ? "page" : undefined}
              >
                <span aria-hidden="true">▦</span>
                Dashboard
              </button>
            )}
            <small>OPERATIONS</small>
            {session.capabilities.financeAnalysis && (
              <button
                className={financeView === "work-queue" ? "active" : ""}
                onClick={() => goFinance("work-queue")}
                aria-current={financeView === "work-queue" && !selected ? "page" : undefined}
              >
                <span aria-hidden="true">☷</span>
                Work Queue
              </button>
            )}
            {session.capabilities.approval && (
              <button
                className={financeView === "approvals" ? "active" : ""}
                onClick={() => goFinance("approvals")}
                aria-current={financeView === "approvals" && !selected ? "page" : undefined}
              >
                <span aria-hidden="true">✓</span>
                Approval Inbox
              </button>
            )}
            {session.capabilities.financeControl && (
              <button
                className={financeView === "finance-control" ? "active" : ""}
                onClick={() => goFinance("finance-control")}
                aria-current={
                  financeView === "finance-control" && !selected ? "page" : undefined
                }
              >
                <span aria-hidden="true">◆</span>
                Finance Control
              </button>
            )}
            {session.capabilities.payment && (
              <button
                className={financeView === "payment-queue" ? "active" : ""}
                onClick={() => goFinance("payment-queue")}
                aria-current={financeView === "payment-queue" && !selected ? "page" : undefined}
              >
                <span aria-hidden="true">→</span>
                Payment Queue
              </button>
            )}
            {(session.capabilities.payment || session.capabilities.reporting) && (
              <button
                className={financeView === "payment-history" ? "active" : ""}
                onClick={() => goFinance("payment-history")}
                aria-current={
                  financeView === "payment-history" && !selected ? "page" : undefined
                }
              >
                <span aria-hidden="true">◷</span>
                Payment History
              </button>
            )}
            {session.capabilities.reporting && (
              <>
                <small>AI INTELLIGENCE</small>
                <button
                  className={financeView === "ai" ? "active" : ""}
                  onClick={() => goFinance("ai")}
                  aria-current={financeView === "ai" && !selected ? "page" : undefined}
                >
                  <span aria-hidden="true">✦</span>
                  Finance Watch &amp; Ask AIMS
                </button>
              </>
            )}
          </>
        )}
      </nav>

      <div className="sideNavFooter">
        <UserCard session={session} workspace={workspace} />

        {session.workspaces.requester && session.workspaces.finance && (
          <button
            className="workspaceSwitch"
            aria-label={`Switch from ${workspace} to ${workspace === "requester" ? "Finance" : "Requester"} workspace`}
            onClick={() =>
              switchWorkspace(workspace === "requester" ? "finance" : "requester")
            }
          >
            Switch to {workspace === "requester" ? "Finance" : "Requester"} Portal
          </button>
        )}

        <button onClick={signOut}>Sign out</button>
      </div>
    </aside>
  );
}
