import { Injectable } from "@nestjs/common";
import { readServerSecret } from "../configuration/secret-boundary.js";

export type AuthenticationEmail = { to: string; subject: string; text: string };

/**
 * Scoped to Authentication only (Forgot Password / Reset Password / future
 * Account Verification) — never used for the business Notification module
 * (payment/approval/reminder/escalation), which remains Future Roadmap.
 */
export interface EmailSender {
  send(message: AuthenticationEmail): Promise<void>;
}

export const EMAIL_SENDER = Symbol("EMAIL_SENDER");

export class EmailDeliveryError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "EmailDeliveryError";
  }
}

/** No email credential configured (e.g. local/dev) — auth flows that need email fail closed rather than silently no-op. */
@Injectable()
export class DisabledEmailSender implements EmailSender {
  async send(): Promise<void> {
    throw new EmailDeliveryError("EMAIL_SENDER_NOT_CONFIGURED");
  }
}

/** Generic HTTP transactional-email API sender: POSTs {to,subject,text} with a bearer key. */
@Injectable()
export class HttpEmailSender implements EmailSender {
  constructor(
    private readonly apiUrl: string,
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly requestTimeoutMs = 10_000,
  ) {}

  async send(message: AuthenticationEmail): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("EMAIL_TIMEOUT")), this.requestTimeoutMs);
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ from: this.fromAddress, to: message.to, subject: message.subject, text: message.text }),
        signal: controller.signal,
      });
      if (!response.ok) throw new EmailDeliveryError(`EMAIL_PROVIDER_STATUS_${response.status}`);
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError("EMAIL_PROVIDER_UNREACHABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createEmailSender(environment: Readonly<Record<string, string | undefined>> = process.env): EmailSender {
  const apiUrl = readServerSecret("EMAIL_API_URL", environment);
  const apiKey = readServerSecret("EMAIL_API_KEY", environment);
  const fromAddress = environment.EMAIL_FROM_ADDRESS;
  if (!apiUrl || !apiKey || !fromAddress) return new DisabledEmailSender();
  return new HttpEmailSender(apiUrl, apiKey, fromAddress);
}
