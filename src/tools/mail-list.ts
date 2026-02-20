import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { withImap } from "../imap-client.js";

export function registerMailListTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "list_emails",
    "List emails in a mailbox folder. Returns sender, subject, date, uid for each email.",
    {
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
      unread_only: z
        .boolean()
        .default(false)
        .describe("Only return unread emails"),
    },
    async ({ account: accountName, folder, limit, unread_only }) => {
      const account = getAccount(config, accountName);
      const emails = await withImap(account, async (client) => {
        const mailbox = await client.mailboxOpen(folder, { readOnly: true });
        if (mailbox.exists === 0) return [];

        const searchCriteria = unread_only ? { unseen: true } : { all: true };
        const uids = await client.search(searchCriteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        const selectedUids = (uids as number[]).slice(-limit).reverse();

        const result: {
          uid: number;
          from: string;
          subject: string;
          date: string;
          seen: boolean;
          hasAttachments: boolean;
        }[] = [];

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
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasAttachment(structure: any): boolean {
  if (!structure) return false;
  if (
    structure.disposition?.toLowerCase() === "attachment" ||
    structure.type?.toLowerCase() === "attachment"
  )
    return true;
  if (structure.childNodes)
    return structure.childNodes.some((c: unknown) => hasAttachment(c));
  return false;
}
