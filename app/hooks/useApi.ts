import { useMemo } from "react";
import { createPortalApi } from "@/app/lib/api-client";
import type { IdentityMode, PortalApi } from "@/app/lib/types";

interface UsePortalApiOptions {
  identityMode: IdentityMode;
  /** Competition identity subject; ignored for LOCAL cookie sessions. */
  user: string | null;
}

/** Stable portal API callback matching legacy `(path, init) => Promise<unknown>`. */
export function usePortalApi({ identityMode, user }: UsePortalApiOptions): PortalApi {
  return useMemo(
    () =>
      createPortalApi({
        identityHeader: identityMode === "COMPETITION" && user ? user : null,
      }),
    [identityMode, user]
  );
}

/** @deprecated Prefer usePortalApi */
export function useApi(options: {
  user: string | null;
  onUnauthenticated?: () => void;
  onForbidden?: () => void;
}) {
  return usePortalApi({ identityMode: "LOCAL", user: options.user || "session" });
}
