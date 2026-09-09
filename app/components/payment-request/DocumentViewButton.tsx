"use client";

import { useEffect, useId, useState } from "react";
import {
  competitionIdentityHeader,
  downloadPaymentDocument,
} from "@/app/lib/document-download";
import type { PaymentRequestDocument } from "@/app/lib/types";

function isImage(mime?: string, filename?: string) {
  if (mime?.startsWith("image/")) return true;
  return /\.(jpe?g|png)$/i.test(filename ?? "");
}

function isPdf(mime?: string, filename?: string) {
  if (mime === "application/pdf") return true;
  return /\.pdf$/i.test(filename ?? "");
}

export function DocumentViewButton({
  requestId,
  document,
  identityHeader,
  className = "secondary textButton",
}: {
  requestId: string;
  document: PaymentRequestDocument;
  identityHeader?: string | null;
  className?: string;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    url: string;
    mimeType: string;
    filename: string;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url);
    };
  }, [preview?.url]);

  async function open() {
    setBusy(true);
    setError("");
    try {
      const file = await downloadPaymentDocument({
        requestId,
        documentId: document.id,
        identityHeader: identityHeader ?? competitionIdentityHeader(),
      });
      const url = URL.createObjectURL(file.blob);
      const mime = file.mimeType || document.mime_type || "application/octet-stream";
      if (isImage(mime, file.filename) || isPdf(mime, file.filename)) {
        setPreview((prev) => {
          if (prev?.url) URL.revokeObjectURL(prev.url);
          return { url, mimeType: mime, filename: file.filename };
        });
      } else {
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open document");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  const rejected = document.security_status === "REJECTED";

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy || rejected}
        onClick={() => void open()}
        aria-label={`View ${document.original_filename}`}
        title={
          rejected
            ? "Rejected documents cannot be opened"
            : document.security_status === "CLEAN"
              ? "View document"
              : "Preview uploaded file (security check still pending)"
        }
      >
        {busy ? "Opening…" : "View"}
      </button>
      {error && (
        <small className="documentViewError" role="alert">
          {error}
        </small>
      )}
      {preview && (
        <div
          className="documentPreviewOverlay"
          role="presentation"
          onClick={close}
        >
          <div
            className="documentPreviewDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <small>DOCUMENT PREVIEW</small>
                <h2 id={titleId}>{preview.filename}</h2>
                {document.security_status && document.security_status !== "CLEAN" && (
                  <p>Security check is still pending. This is a local preview only.</p>
                )}
              </div>
              <div className="documentPreviewActions">
                <a className="secondary" href={preview.url} download={preview.filename}>
                  Download
                </a>
                <button type="button" className="secondary" onClick={close}>
                  Close
                </button>
              </div>
            </header>
            {isImage(preview.mimeType, preview.filename) ? (
              // Object URL from authenticated download; not a remote user URL.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.filename} />
            ) : (
              <iframe title={preview.filename} src={preview.url} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
