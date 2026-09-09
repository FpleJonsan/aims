import type { PortalSession } from "@/app/lib/types";
import { getUserInitials } from "@/app/lib/utils";

interface UserCardProps {
  session: PortalSession;
}

export function UserCard({ session }: UserCardProps) {
  const initials = getUserInitials(session.user.displayName);

  return (
    <div className="userCard">
      <b aria-hidden="true">{initials}</b>
      <span>
        <strong>{session.user.displayName}</strong>
        <small>{session.user.department}</small>
      </span>
    </div>
  );
}
