import { useCallback, useMemo } from "react";
import { createApiClient, type ApiClient } from "@/app/lib/api-client";

interface UseApiOptions {
  user: string | null;
  onUnauthenticated?: () => void;
  onForbidden?: () => void;
}

export function useApi({
  user,
  onUnauthenticated,
  onForbidden,
}: UseApiOptions): ApiClient | null {
  const client = useMemo(() => {
    if (!user) return null;

    return createApiClient({
      user,
      onUnauthenticated,
      onForbidden,
    });
  }, [user, onUnauthenticated, onForbidden]);

  return client;
}
