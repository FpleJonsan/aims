import type { PortalApi } from "@/app/lib/types";

export const API_BASE_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_AIMS_API_URL ?? "http://localhost:3001"
    : "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientConfig {
  /** When set (Competition mode), sent as x-aims-user. Cookie sessions omit this. */
  identityHeader?: string | null;
  onUnauthenticated?: (message: string) => void;
  onForbidden?: (path: string) => void;
}

export class ApiClient {
  private identityHeader: string | null;
  private onUnauthenticated?: (message: string) => void;
  private onForbidden?: (path: string) => void;

  constructor(config: ApiClientConfig = {}) {
    this.identityHeader = config.identityHeader ?? null;
    this.onUnauthenticated = config.onUnauthenticated;
    this.onForbidden = config.onForbidden;
  }

  async request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const method = (init?.method ?? "GET").toUpperCase();
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(!["GET", "HEAD", "OPTIONS"].includes(method)
          ? { "x-aims-csrf": readCookie("aims_csrf") }
          : {}),
        ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
        ...(this.identityHeader ? { "x-aims-user": this.identityHeader } : {}),
        ...init?.headers,
      },
    });

    const data = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? "Request failed");

    if (response.status === 401) {
      this.onUnauthenticated?.(message);
      throw Object.assign(new Error(message), { status: 401 });
    }

    if (response.status === 403 && path !== "/session") {
      this.onForbidden?.(path);
    }

    if (!response.ok) {
      throw Object.assign(new Error(message), { status: response.status });
    }

    return data as T;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body ?? {}),
    });
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path, { method: "DELETE" });
  }

  setIdentityHeader(user: string | null) {
    this.identityHeader = user;
  }

  /** Compatible with historical portal `(path, init) => Promise` call sites. */
  asPortalApi(): PortalApi {
    return (path, init) => this.request(path, init);
  }
}

export function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

export function createApiClient(config: ApiClientConfig = {}): ApiClient {
  return new ApiClient(config);
}

/** Portal API that dispatches the same window events as the legacy inline client. */
export function createPortalApi(options: {
  identityHeader?: string | null;
}): PortalApi {
  const client = createApiClient({
    identityHeader: options.identityHeader,
    onUnauthenticated: (message) => {
      window.dispatchEvent(
        new CustomEvent("aims:unauthenticated", { detail: { message } })
      );
    },
    onForbidden: (path) => {
      window.dispatchEvent(new CustomEvent("aims:forbidden", { detail: { path } }));
    },
  });
  return client.asPortalApi();
}
