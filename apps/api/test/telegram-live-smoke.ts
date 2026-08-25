import { TelegramApprovalChannel } from "../src/application/approval/telegram-approval.channel.js";

const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_TEST_CHAT_ID;
if(!token||!chatId)throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_TEST_CHAT_ID are required for this opt-in test");
const auth=await fetch(`https://api.telegram.org/bot${token}/getMe`);if(!auth.ok)throw new Error(`Telegram bot authentication failed (${auth.status})`);
await new TelegramApprovalChannel(token).send({chatId,ticketNumber:"AIMS-LIVE-SMOKE",amount:"0.00",currency:"MYR",purpose:"Synthetic non-payment integration test",callbacks:{approve:"smoke.approve",reject:"smoke.reject",clarify:"smoke.clarify"}});
console.log("Telegram live smoke passed: authentication and safe synthetic message delivery succeeded.");
