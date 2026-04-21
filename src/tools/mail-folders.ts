import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";

export function buildMailFolderTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const list_folders: ToolDef<{ account: z.ZodDefault<z.ZodString> }, ToolsContext> = {
    name: "list_folders",
    description: "List all IMAP mailbox folders for an account.",
    shape: {
      account: z.string().default(defaultName).describe(description),
    },
    handler: async (ctx, { account: accountName }) => {
      const account = getAccount(ctx.config, accountName);
      const folders = await withImap(account, async (client) => {
        const mailboxes = await client.list();
        return mailboxes.map((m) => ({ path: m.path, name: m.name }));
      });
      return {
        content: [{ type: "text", text: JSON.stringify(folders, null, 2) }],
      };
    },
  };

  return [list_folders];
}
