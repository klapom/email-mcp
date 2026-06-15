import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import nodemailer from "nodemailer";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import { type MailAttachment, sendEmail } from "../upstream/smtp-client.js";
import type { ToolsContext } from "./context.js";

// Accepted attachment input: an absolute file path string, or an object with
// either a {filename, path} or {filename, content_base64} pair.
const attachmentInput = z.union([
  z.string(),
  z.object({
    filename: z.string().optional(),
    path: z.string().optional(),
    content_base64: z.string().optional(),
  }),
]);
type AttachmentInput = z.infer<typeof attachmentInput>;

const attachmentsParam = z
  .array(attachmentInput)
  .optional()
  .describe(
    "Files to attach. Each entry is an absolute file path string, or " +
      "{filename, path}, or {filename, content_base64} for inline bytes.",
  );

/** Normalise the tool's attachment input into nodemailer attachment objects. */
function toMailAttachments(items?: AttachmentInput[]): MailAttachment[] | undefined {
  if (!items || items.length === 0) return undefined;
  return items.map((it) => {
    if (typeof it === "string") return { path: it };
    if (it.content_base64) {
      return { filename: it.filename, content: Buffer.from(it.content_base64, "base64") };
    }
    return { filename: it.filename, path: it.path };
  });
}

export function buildMailSendTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const send_email: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "send_email",
    description: "Send a new email via SMTP.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC recipients (optional)"),
      bcc: z.string().optional().describe("BCC recipients (optional)"),
      attachments: attachmentsParam,
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        to,
        subject,
        body,
        cc,
        bcc,
        attachments,
      } = args as {
        account: string;
        to: string;
        subject: string;
        body: string;
        cc?: string;
        bcc?: string;
        attachments?: AttachmentInput[];
      };
      const account = getAccount(ctx.config, accountName);
      const messageId = await sendEmail(account, {
        to,
        subject,
        text: body,
        cc,
        bcc,
        attachments: toMailAttachments(attachments),
      });
      return {
        content: [{ type: "text", text: `Email sent. Message-ID: ${messageId}` }],
      };
    },
  };

  const reply_email: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "reply_email",
    description: "Reply to an existing email. Keeps threading via message-ID.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es)"),
      subject: z.string().describe("Subject (usually Re: Original Subject)"),
      body: z.string().describe("Reply body text"),
      in_reply_to: z.string().describe("Message-ID of the email being replied to"),
      cc: z.string().optional().describe("CC recipients (optional)"),
      attachments: attachmentsParam,
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        to,
        subject,
        body,
        in_reply_to,
        cc,
        attachments,
      } = args as {
        account: string;
        to: string;
        subject: string;
        body: string;
        in_reply_to: string;
        cc?: string;
        attachments?: AttachmentInput[];
      };
      const account = getAccount(ctx.config, accountName);
      const messageId = await sendEmail(account, {
        to,
        subject,
        text: body,
        cc,
        inReplyTo: in_reply_to,
        references: in_reply_to,
        attachments: toMailAttachments(attachments),
      });
      return {
        content: [{ type: "text", text: `Reply sent. Message-ID: ${messageId}` }],
      };
    },
  };

  const save_draft: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "save_draft",
    description:
      "Save an email as a draft in the IMAP Drafts folder (does NOT send it). Use this when the user wants to prepare an email for review before sending.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      to: z.string().describe("Recipient email address(es), comma-separated"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Email body (plain text)"),
      cc: z.string().optional().describe("CC recipients (optional)"),
      attachments: attachmentsParam,
      draft_folder: z
        .string()
        .optional()
        .describe(
          'IMAP folder name for drafts. Defaults to "Drafts". Try "Entwürfe" for GMX/Web.de if Drafts does not work.',
        ),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        to,
        subject,
        body,
        cc,
        attachments,
        draft_folder,
      } = args as {
        account: string;
        to: string;
        subject: string;
        body: string;
        cc?: string;
        attachments?: AttachmentInput[];
        draft_folder?: string;
      };
      const account = getAccount(ctx.config, accountName);
      const folder = draft_folder ?? "Drafts";

      const from = account.fromName ? `${account.fromName} <${account.user}>` : account.user;
      const mailAttachments = toMailAttachments(attachments);

      const raw = await new Promise<Buffer>((resolve, reject) => {
        const mail = nodemailer.createTransport({ streamTransport: true });
        mail.sendMail({ from, to, subject, text: body, cc, date: new Date(), attachments: mailAttachments }, (err, info) => {
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
        });
      });

      const result = await withImap(account, async (client) => {
        return client.append(folder, raw, ["\\Draft", "\\Seen"]);
      });

      const uid =
        result && typeof result === "object" && "uid" in result
          ? ` (UID ${(result as { uid: number }).uid})`
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
  };

  return [send_email, reply_email, save_draft];
}
