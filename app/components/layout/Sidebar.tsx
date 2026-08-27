import type { PortalSession, Workspace, FinanceView } from "@/app/lib/types";
import { Brand } from "./Brand";
import { UserCard } from "./UserCard";

interface SidebarProps {
  session: PortalSession;
  workspace: Workspace;
  financeView: FinanceView;
  requesterHome: boolean;
  selected: boolean;
  onNavigate: {
    goRequester: (home: boolean) => void;
    goFinance: (view: FinanceView) => void;
    initiate: () => void;
    switchWorkspace: (workspace: Workspace) => void;
  };
}

export function Sidebar({
  session,
  workspace,
  financeView,
  requesterHome,
  selected,
  onNavigate,
}: SidebarProps) {
  const { goRequester, goFinance, initiate, switchWorkspace } = onNavigate;

  return (
    <aside className="sideNav">
      <Brand />

      <nav aria-label="Primary navigation" className="primaryNav">
        {workspace === "requester" ? (
          <>
            <button
              className={requesterHome && !selected ? "active" : ""}
              onClick={() => goRequester(true)}
              aria-current={requesterHome && !selected ? "page" : undefined}
            >
              <span aria-hidden="true">▦</span>
              Dashboard
            </button>
            <button
              className={!requesterHome && !selected ? "active" : ""}
              onClick={() => goRequester(false)}
              aria-current={!requesterHome && !selected ? "page" : undefined}
            >
              <span aria-hidden="true">☷</span>
              My Requests
            </button>
            <button onClick={() => void initiate()}>
              <span aria-hidden="true">＋</span>
              New Request
            </button>
            <button
              onClick={() => {
                goRequester(false);
              }}
            >
              <span aria-hidden="true">◷</span>
              Payment Status
            </button>
          </>
        ) : (
          <>
            {session.capabilities.reporting && (
              <button
                className={financeView === "dashboard" ? "active" : ""}
                onClick={() => goFinance("dashboard")}
                aria-current={financeView === "dashboard" ? "page" : undefined}
              >
                <span aria-hidden="true">▦</span>
                Dashboard
              </button>
            )}
            {session.capabilities.financeAnalysis && (
              <button
                className={financeView === "work-queue" && !selected ? "active" : ""}
                onClick={() => goFinance("work-queue")}
                aria-current={
                  financeView === "work-queue" && !selected ? "page" : undefined
                }
              >
                <span aria-hidden="true">☷</span>
                Work Queue
              </button>
            )}
            {session.capabilities.approval && (
              <button
                className={financeView === "approvals" ? "active" : ""}
                onClick={() => goFinance("approvals")}
                aria-current={financeView === "approvals" ? "page" : undefined}
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
                  financeView === "finance-control" ? "page" : undefined
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
                aria-current={financeView === "payment-queue" ? "page" : undefined}
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
                  financeView === "payment-history" ? "page" : undefined
                }
              >
                <span aria-hidden="true">◷</span>
                Payment History
              </button>
            )}
          </>
        )}
      </nav>

      {workspace === "finance" && (
        <nav aria-label="AIMS workflow stages" className="workflowNav">
          <span>
            <i>1–2</i>Request Capture
          </span>
          <span>
            <i>3</i>Validation
          </span>
          <span>
            <i>4</i>Finance Context
          </span>
          <span>
            <i>5</i>Financial Risk
          </span>
          <span>
            <i>6</i>Policy & Decision
          </span>
          <span>
            <i>7</i>Approval
          </span>
          <span>
            <i>8</i>Final Control
          </span>
          <span>
            <i>9</i>Payment
          </span>
        </nav>
      )}

      {workspace === "finance" && session.capabilities.reporting && (
        <nav aria-label="Finance reporting" className="reportingNav">
          <span>
            <i>10</i>Payment History
          </span>
          <span>
            <i>11</i>Dashboard
          </span>
          <span>
            <i>12</i>AI Intelligence
          </span>
        </nav>
      )}

      <UserCard session={session} />

      {session.workspaces.requester && session.workspaces.finance && (
        <button
          className="workspaceSwitch"
          onClick={() =>
            switchWorkspace(workspace === "requester" ? "finance" : "requester")
          }
          aria-label={`Switch to ${workspace === "requester" ? "Finance" : "Requester"} workspace`}
        >
          Switch to {workspace === "requester" ? "Finance" : "Requester"}
        </button>
      )}
    </aside>
  );
}
