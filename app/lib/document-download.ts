import { API_BASE_URL, readCookie } from "@/app/lib/api-client";

export async function downloadPaymentDocument(options: {
  requestId: string;
  documentId: string;
  identityHeader?: string | null;
}): Promise<{ blob: Blob; mimeType: string; filename: string }> {
  const headers: Record<string, string> = {};
  if (options.identityHeader) headers["x-aims-user"] = options.identityHeader;

  const response = await fetch(
    `${API_BASE_URL}/payment-requests/${options.requestId}/documents/${options.documentId}/download`,
    { credentials: "include", headers }
  );

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(data.message)
      ? data.message.join(", ")
      : (data.message ?? "Unable to open document");
    throw new Error(message);
  }

  const blob = await response.blob();
  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() ||
    blob.type ||
    "application/octet-stream";
  const disposition = response.headers.get("content-disposition") ?? "";
  const utfName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = decodeURIComponent(utfName || plainName || "document");

  return { blob, mimeType, filename };
}

/** Best-effort competition identity; prefer passing identityHeader from the session. */
export function competitionIdentityHeader(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem("aims-competition-user") || readCookie("aims_user") || null;
}
