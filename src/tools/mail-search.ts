import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { withImap } from "../imap-client.js";

export function registerMailSearchTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "search_emails",
    "Search emails by sender, subject, or body text.",
    {
      account: z.string().default(defaultName).describe(description),
      query: z.string().describe("Search text"),
      search_in: z
        .enum(["subject", "from", "body", "all"])
        .default("all")
        .describe("Where to search: subject, from, body, or all"),
      folder: z.string().default("INBOX").describe("IMAP folder to search in"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max results"),
    },
    async ({ account: accountName, query, search_in, folder, limit }) => {
      const account = getAccount(config, accountName);
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
              or: [
                { header: ["subject", query] },
                { header: ["from", query] },
                { body: query },
              ],
            };
        }

        const uids = await client.search(criteria, { uid: true });
        if (!uids || uids.length === 0) return [];

        const selectedUids = (uids as number[]).slice(-limit).reverse();

        const result: {
          uid: number;
          from: string;
          subject: string;
          date: string;
          seen: boolean;
        }[] = [];

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
  );
}
