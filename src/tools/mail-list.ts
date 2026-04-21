import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";

// biome-ignore lint/suspicious/noExplicitAny: imapflow bodyStructure is loosely typed
function hasAttachment(structure: any): boolean {
  if (!structure) return false;
  if (
    structure.disposition?.toLowerCase() === "attachment" ||
    structure.type?.toLowerCase() === "attachment"
  )
    return true;
  if (structure.childNodes) return structure.childNodes.some((c: unknown) => hasAttachment(c));
  return false;
}

export function buildMailListTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const list_emails: ToolDef<
    {
      account: z.ZodDefault<z.ZodString>;
      folder: z.ZodDefault<z.ZodString>;
      limit: z.ZodDefault<z.ZodNumber>;
      unread_only: z.ZodDefault<z.ZodBoolean>;
    },
    ToolsContext
  > = {
    name: "list_emails",
    description:
      "List emails in a mailbox folder. Returns sender, subject, date, uid for each email.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      folder: z
        .string()
        .default("INBOX")
        .describe("IMAP folder path, e.g. INBOX, Sent, INBOX.Spam"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Max number of emails to return (newest first)"),
      unread_only: z.boolean().default(false).describe("Only return unread emails"),
    },
    handler: async (ctx, { account: accountName, folder, limit, unread_only }) => {
      const account = getAccount(ctx.config, accountName);
      const emails = await withImap(account, async (client) => {
        const mailbox = await client.mailboxOpen(folder, { readOnly: true });
        if (mailbox.exists === 0) return [];

        const searchCriteria = unread_only ? { unseen: true } : { all: true };
        const uids = await client.search(searchCriteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        const selectedUids = (uids as number[]).slice(-limit).reverse();

        const result: Array<{
          uid: number;
          from: string;
          subject: string;
          date: string;
          seen: boolean;
          hasAttachments: boolean;
        }> = [];

        for await (const msg of client.fetch(
          selectedUids,
          { envelope: true, flags: true, bodyStructure: true },
          { uid: true },
        )) {
          const from = msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
            : "unknown";
          result.push({
            uid: msg.uid,
            from,
            subject: msg.envelope?.subject ?? "(no subject)",
            date: msg.envelope?.date?.toISOString() ?? "",
            seen: msg.flags?.has("\\Seen") ?? false,
            hasAttachments: hasAttachment(msg.bodyStructure),
          });
        }
        return result;
      });

      return {
        content: [{ type: "text", text: JSON.stringify(emails, null, 2) }],
      };
    },
  };

  return [list_emails];
}
