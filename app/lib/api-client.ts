const API_BASE_URL =
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
  user: string;
  onUnauthenticated?: () => void;
  onForbidden?: () => void;
}

export class ApiClient {
  private user: string;
  private onUnauthenticated?: () => void;
  private onForbidden?: () => void;

  constructor(config: ApiClientConfig) {
    this.user = config.user;
    this.onUnauthenticated = config.onUnauthenticated;
    this.onForbidden = config.onForbidden;
  }

  async request<T = unknown>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    if (!this.user) {
      throw new ApiError("Sign in required", 401, "Unauthorized");
    }

    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        "x-aims-user": this.user,
        ...(init?.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });

    // Handle auth errors
    if (response.status === 401) {
      this.onUnauthenticated?.();
      throw new ApiError("Authentication required", 401, response.statusText);
    }

    if (response.status === 403) {
      this.onForbidden?.();
      throw new ApiError("Access forbidden", 403, response.statusText);
    }

    // Parse response
    const data = await response.json().catch(() => ({})) as {
      message?: string | string[];
    };

    if (!response.ok) {
      const message = Array.isArray(data.message)
        ? data.message.join(", ")
        : data.message ?? `Request failed: ${response.statusText}`;
      throw new ApiError(message, response.status, response.statusText);
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

  setUser(user: string) {
    this.user = user;
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  return new ApiClient(config);
}
