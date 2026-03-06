import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import { type Config, accountParam, getAccount } from "../config.js";
import { sendEmail } from "../smtp-client.js";
import { withImap } from "../imap-client.js";

export function registerMailSendTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "send_email",
    "Send a new email via SMTP.",
    {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC recipients (optional)"),
      bcc: z.string().optional().describe("BCC recipients (optional)"),
    },
    async ({ account: accountName, to, subject, body, cc, bcc }) => {
      const account = getAccount(config, accountName);
      const messageId = await sendEmail(account, { to, subject, text: body, cc, bcc });
      return {
        content: [{ type: "text", text: `Email sent. Message-ID: ${messageId}` }],
      };
    },
  );

  server.tool(
    "reply_email",
    "Reply to an existing email. Keeps threading via message-ID.",
    {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es)"),
      subject: z.string().describe("Subject (usually Re: Original Subject)"),
      body: z.string().describe("Reply body text"),
      in_reply_to: z
        .string()
        .describe("Message-ID of the email being replied to"),
      cc: z.string().optional().describe("CC recipients (optional)"),
    },
    async ({ account: accountName, to, subject, body, in_reply_to, cc }) => {
      const account = getAccount(config, accountName);
      const messageId = await sendEmail(account, {
        to,
        subject,
        text: body,
        cc,
        inReplyTo: in_reply_to,
        references: in_reply_to,
      });
      return {
        content: [{ type: "text", text: `Reply sent. Message-ID: ${messageId}` }],
      };
    },
  );

  server.tool(
    "save_draft",
    "Save an email as a draft in the IMAP Drafts folder (does NOT send it). " +
      "Use this when the user wants to prepare an email for review before sending.",
    {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC recipients (optional)"),
      draft_folder: z
        .string()
        .optional()
        .describe(
          'IMAP folder name for drafts. Defaults to "Drafts". ' +
            'Try "Entwürfe" for GMX/Web.de if Drafts does not work.',
        ),
    },
    async ({ account: accountName, to, subject, body, cc, draft_folder }) => {
      const account = getAccount(config, accountName);
      const folder = draft_folder ?? "Drafts";

      const from = account.fromName
        ? `${account.fromName} <${account.user}>`
        : account.user;

      // Build RFC 2822 raw message via nodemailer without sending
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const mail = nodemailer.createTransport({ streamTransport: true });
        mail.sendMail(
          { from, to, subject, text: body, cc, date: new Date() },
          (err, info) => {
            if (err) return reject(err);
            const stream = info.message;
            if (!stream || typeof (stream as NodeJS.ReadableStream).on !== "function") {
              return reject(new Error("nodemailer did not return a readable stream"));
            }
            const readable = stream as NodeJS.ReadableStream;
            const chunks: Buffer[] = [];
            readable.on("data", (chunk: Buffer) => chunks.push(chunk));
            readable.on("end", () => resolve(Buffer.concat(chunks)));
            readable.on("error", reject);
          },
        );
      });

      const result = await withImap(account, async (client) => {
        return client.append(folder, raw, ["\\Draft", "\\Seen"]);
      });

      const uid = result && typeof result === "object" && "uid" in result
        ? ` (UID ${result.uid})`
        : "";
      return {
        content: [
          {
            type: "text",
            text: `Draft saved to "${folder}"${uid}. Subject: "${subject}"`,
          },
        ],
      };
    },
  );
}
