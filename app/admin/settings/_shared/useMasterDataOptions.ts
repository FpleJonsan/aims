"use client";

import { useEffect, useState } from "react";
import { authApiGet } from "../../../lib/auth-api";

export type MasterDataOption = { id: string; code: string; name: string };

/** Loads active Master Data rows for a settings dropdown (default currency, department, ...). Reuses the P20.5C Master Data list endpoint — read-only, no new API surface. */
export function useMasterDataOptions(domain: "currencies" | "departments" | "projects" | "categories" | "payment-methods"): MasterDataOption[] {
  const [options, setOptions] = useState<MasterDataOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    authApiGet<{ items: MasterDataOption[] }>(`/admin/master-data/${domain}?status=active&pageSize=100`)
      .then((response) => {
        if (!cancelled) setOptions(response.items);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);
  return options;
}
