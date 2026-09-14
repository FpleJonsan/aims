const API_BASE_URL =
  typeof window !== "undefined" ? (process.env.NEXT_PUBLIC_AIMS_API_URL ?? "http://localhost:3001") : "http://localhost:3001";

export class AuthApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "AuthApiError";
  }
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}

/**
 * Used both by the pre-auth pages (login/register/forgot/reset) and by the
 * signed-in Finance Master admin console. Unlike `ApiClient` (api-client.ts),
 * which rewrites every 401 into a generic "Authentication required" for the
 * already-signed-in app, this surfaces the server's own message as-is — the
 * distinction that matters for the pre-auth pages ("invalid email or
 * password" vs. a generic rewrite) is harmless for the admin console too.
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) ? { "x-aims-csrf": readCookie("aims_csrf") } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(data.message) ? data.message.join(", ") : data.message ?? `Request failed (${response.status})`;
    throw new AuthApiError(message, response.status);
  }
  return data as T;
}

export function authApiGet<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

export function authApiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
}

export function authApiPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });
}

export function authApiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) });
}

export function authApiDelete<T = unknown>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
