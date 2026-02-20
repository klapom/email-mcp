import nodemailer from "nodemailer";
import type { AccountConfig } from "./config.js";

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}

export async function sendEmail(
  account: AccountConfig,
  options: SendOptions,
): Promise<string> {
  const transport = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: {
      user: account.user,
      pass: account.password,
    },
  });

  const from = account.fromName
    ? `${account.fromName} <${account.user}>`
    : account.user;

  const info = await transport.sendMail({ from, ...options });
  return info.messageId;
}
