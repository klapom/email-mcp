import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { withImap } from "../imap-client.js";

export function registerMailFolderTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "list_folders",
    "List all IMAP mailbox folders for an account.",
    {
      account: z.string().default(defaultName).describe(description),
    },
    async ({ account: accountName }) => {
      const account = getAccount(config, accountName);
      const folders = await withImap(account, async (client) => {
        const mailboxes = await client.list();
        return mailboxes.map((m) => ({ path: m.path, name: m.name }));
      });

      return {
        content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
      };
    },
  );
}
