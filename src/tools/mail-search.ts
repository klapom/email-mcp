import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";

export function buildMailSearchTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const search_emails: ToolDef<
    {
      account: z.ZodDefault<z.ZodString>;
      query: z.ZodString;
      search_in: z.ZodDefault<z.ZodEnum<["subject", "from", "body", "all"]>>;
      folder: z.ZodDefault<z.ZodString>;
      limit: z.ZodDefault<z.ZodNumber>;
    },
    ToolsContext
  > = {
    name: "search_emails",
    description: "Search emails by sender, subject, or body text.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      query: z.string().describe("Search text"),
      search_in: z
        .enum(["subject", "from", "body", "all"])
        .default("all")
        .describe("Where to search: subject, from, body, or all"),
      folder: z.string().default("INBOX").describe("IMAP folder to search in"),
      limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
    },
    handler: async (ctx, { account: accountName, query, search_in, folder, limit }) => {
      const account = getAccount(ctx.config, accountName);
      const emails = await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: true });

        let criteria: Record<string, unknown>;
        switch (search_in) {
          case "subject":
            criteria = { header: ["subject", query] };
            break;
          case "from":
            criteria = { header: ["from", query] };
            break;
          case "body":
            criteria = { body: query };
            break;
          default:
            criteria = {
              or: [{ header: ["subject", query] }, { header: ["from", query] }, { body: query }],
            };
        }

        const uids = await client.search(criteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        const selectedUids = (uids as number[]).slice(-limit).reverse();

        const result: Array<{
          uid: number;
          from: string;
          subject: string;
          date: string;
          seen: boolean;
        }> = [];

        for await (const msg of client.fetch(
          selectedUids,
          { envelope: true, flags: true },
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
          });
        }
        return result;
      });

      return {
        content: [
          {
            type: "text",
            text:
              emails.length === 0
                ? `No emails found for: "${query}"`
                : JSON.stringify(emails, null, 2),
          },
        ],
      };
    },
  };

  return [search_emails];
}
