import assert from "node:assert/strict";
import test from "node:test";
import { DisabledApprovalChannel, TelegramApprovalChannel } from "../src/application/approval/telegram-approval.channel.js";

test("Telegram approval message is minimized and uses opaque callback data", async () => {
  const original=globalThis.fetch;let request:RequestInit|undefined;
  globalThis.fetch=(async (_input:URL|string|Request,init?:RequestInit)=>{request=init;return new Response(JSON.stringify({ok:true}),{status:200});}) as typeof fetch;
  try {await new TelegramApprovalChannel("server-secret").send({chatId:"1",ticketNumber:"PAY-2026-1",amount:"10.00",currency:"MYR",purpose:"Synthetic test",callbacks:{approve:"approve-token",reject:"reject-token",clarify:"clarify-token"}});
    const body=JSON.parse(String(request?.body));assert.equal(body.reply_markup.inline_keyboard[0][0].callback_data,"approve-token");assert.equal(body.reply_markup.inline_keyboard[0][1].callback_data,"reject-token");assert.doesNotMatch(body.text,/bank|account|payment details/i);
  } finally {globalThis.fetch=original;}
});
test("disabled Telegram delivery fails without affecting approval business state", async()=>{await assert.rejects(()=>new DisabledApprovalChannel().send(),/TELEGRAM_NOT_CONFIGURED/);});
