import type { PortalSession, Workspace } from "@/app/lib/types";
import { getUserInitials } from "@/app/lib/utils";

interface UserCardProps {
  session: PortalSession;
  workspace?: Workspace;
}

export function UserCard({ session, workspace }: UserCardProps) {
  const initials = getUserInitials(session.user.displayName);

  return (
    <div className="userCard">
      <b aria-hidden="true">{initials}</b>
      <span>
        <strong>{session.user.displayName}</strong>
        <small>{session.user.department}</small>
        {workspace && (
          <small>
            Current workspace: {workspace === "requester" ? "Requester" : "Finance"}
          </small>
        )}
      </span>
    </div>
  );
}
