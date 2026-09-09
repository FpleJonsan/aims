import { Brand } from "@/app/components/layout/Brand";
import type { PortalSession } from "@/app/lib/types";

export function SessionProblem({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <main className="protectedState">
      <Brand />
      <section role="alert">
        <span className="stateIcon">!</span>
        <h1>Unable to verify your session</h1>
        <p>{message || "The AIMS session service is temporarily unavailable."}</p>
        <button className="primary" onClick={retry}>
          Retry session check
        </button>
      </section>
    </main>
  );
}

export function NoAccess({
  session,
  signOut,
}: {
  session: PortalSession | null;
  signOut: () => void;
}) {
  return (
    <main className="protectedState">
      <Brand />
      <section>
        <span className="stateIcon" aria-hidden="true">
          —
        </span>
        <h1>No workspace access</h1>
        <p>
          Your account{session ? ` (${session.user.displayName})` : ""} is active, but no AIMS
          workspace is currently assigned.
        </p>
        <p>Contact your system administrator or Finance administrator if this is unexpected.</p>
        <button className="primary" onClick={signOut}>
          Sign out
        </button>
      </section>
    </main>
  );
}
