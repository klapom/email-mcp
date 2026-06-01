import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import type { MessageEnvelopeObject } from "imapflow";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";
import { type MimePart, attachmentList, decodeBody, flattenParts } from "./mime.js";

export function buildMailReadTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const read_email: ToolDef<
    {
      account: z.ZodDefault<z.ZodString>;
      uid: z.ZodNumber;
      folder: z.ZodDefault<z.ZodString>;
      mark_as_read: z.ZodDefault<z.ZodBoolean>;
    },
    ToolsContext
  > = {
    name: "read_email",
    description: "Read the full content of an email by its UID.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID from list_emails"),
      folder: z.string().default("INBOX").describe("IMAP folder path"),
      mark_as_read: z.boolean().default(true).describe("Mark as read after fetching"),
    },
    handler: async (ctx, { account: accountName, uid, folder, mark_as_read }) => {
      const account = getAccount(ctx.config, accountName);
      const email = await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: false });

        // Step 1: fetch envelope + parsed BODYSTRUCTURE only. We deliberately do
        // NOT request `source`, so attachment bytes never leave the server here —
        // read_email latency is independent of attachment size (#2).
        let envelope: MessageEnvelopeObject | undefined;
        let resolvedUid = uid;
        let parts: MimePart[] = [];
        let found = false;
        for await (const msg of client.fetch(
          [uid],
          { envelope: true, bodyStructure: true },
          { uid: true },
        )) {
          found = true;
          envelope = msg.envelope;
          resolvedUid = msg.uid;
          parts = flattenParts(msg.bodyStructure);
        }
        if (!found) return null;

        // Step 2: download only the text body parts (text/plain + text/html).
        // Attachments are left untouched — fetched lazily via get_attachment.
        const textPart = parts.find((p) => p.isText && p.mimeType === "text/plain");
        const htmlPart = parts.find((p) => p.isText && p.mimeType === "text/html");
        const wantParts = [textPart, htmlPart].filter((p): p is MimePart => p !== undefined);

        let textBody = "";
        let htmlBody = "";
        if (wantParts.length > 0) {
          for await (const msg of client.fetch(
            [uid],
            { bodyParts: wantParts.map((p) => p.part) },
            { uid: true },
          )) {
            for (const p of wantParts) {
              const raw = msg.bodyParts?.get(p.part);
              if (!raw) continue;
              const decoded = decodeBody(raw.toString("binary"), p.encoding);
              if (p.mimeType === "text/plain") textBody = decoded;
              else if (p.mimeType === "text/html") htmlBody = decoded;
            }
          }
        }

        if (mark_as_read) {
          await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
        }

        const from = envelope?.from?.[0]
          ? `${envelope.from[0].name ?? ""} <${envelope.from[0].address}>`.trim()
          : "unknown";
        const to =
          envelope?.to?.map((a) => `${a.name ?? ""} <${a.address}>`.trim()).join(", ") ?? "";

        return {
          uid: resolvedUid,
          from,
          to,
          subject: envelope?.subject ?? "(no subject)",
          date: envelope?.date?.toISOString() ?? "",
          messageId: envelope?.messageId ?? "",
          body: textBody || htmlBody || "(no text body)",
          bodyType: textBody ? "text" : "html",
          attachments: attachmentList(parts),
        };
      });

      if (!email) {
        return {
          content: [{ type: "text", text: `Email UID ${uid} not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(email, null, 2) }] };
    },
  };

  return [read_email];
}
