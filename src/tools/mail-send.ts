import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { sendEmail } from "../smtp-client.js";

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
}
