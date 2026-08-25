import { Injectable } from "@nestjs/common";
export type ApprovalNotification = {
  chatId: string;
  ticketNumber: string;
  amount: string;
  currency: string;
  purpose: string;
  callbacks: { approve: string; reject: string; clarify: string };
};
export interface ApprovalChannel {
  send(message: ApprovalNotification): Promise<void>;
}
export const APPROVAL_CHANNEL = Symbol("APPROVAL_CHANNEL");
@Injectable()
export class TelegramApprovalChannel implements ApprovalChannel {
  constructor(private readonly token: string) {}
  async send(m: ApprovalNotification) {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: m.chatId,
          text: `AIMS approval required\n${m.ticketNumber}\n${m.currency} ${m.amount}\n${m.purpose}`,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve", callback_data: m.callbacks.approve },
                { text: "Reject", callback_data: m.callbacks.reject },
              ],
              [
                {
                  text: "Request clarification",
                  callback_data: m.callbacks.clarify,
                },
              ],
            ],
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`TELEGRAM_HTTP_${response.status}`);
    const body = (await response.json()) as { ok?: boolean };
    if (!body.ok) throw new Error("TELEGRAM_API_REJECTED");
  }
}
export class DisabledApprovalChannel implements ApprovalChannel {
  async send() {
    throw new Error("TELEGRAM_NOT_CONFIGURED");
  }
}
