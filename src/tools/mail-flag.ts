import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { withImap } from "../imap-client.js";

export function registerMailFlagTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "mark_email",
    "Mark an email as read, unread, flagged, or unflagged.",
    {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      folder: z.string().default("INBOX").describe("IMAP folder path"),
      action: z
        .enum(["read", "unread", "flag", "unflag"])
        .describe("Action to perform"),
    },
    async ({ account: accountName, uid, folder, action }) => {
      const account = getAccount(config, accountName);
      await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: false });
        switch (action) {
          case "read":
            await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
            break;
          case "unread":
            await client.messageFlagsRemove([uid], ["\\Seen"], { uid: true });
            break;
          case "flag":
            await client.messageFlagsAdd([uid], ["\\Flagged"], { uid: true });
            break;
          case "unflag":
            await client.messageFlagsRemove([uid], ["\\Flagged"], { uid: true });
            break;
        }
      });
      return {
        content: [{ type: "text", text: `Email UID ${uid} marked as ${action}.` }],
      };
    },
  );

  server.tool(
    "delete_email",
    "Move an email to Trash (or permanently delete if already in Trash).",
    {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      folder: z.string().default("INBOX").describe("Source IMAP folder"),
      trash_folder: z
        .string()
        .default("Trash")
        .describe("Trash folder name (e.g. Trash, INBOX.Trash, [Gmail]/Trash)"),
    },
    async ({ account: accountName, uid, folder, trash_folder }) => {
      const account = getAccount(config, accountName);
      await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: false });
        if (folder.toLowerCase() === trash_folder.toLowerCase()) {
          await client.messageFlagsAdd([uid], ["\\Deleted"], { uid: true });
          await client.mailboxClose();
        } else {
          await client.messageMove([uid], trash_folder, { uid: true });
        }
      });
      return {
        content: [{ type: "text", text: `Email UID ${uid} moved to ${trash_folder}.` }],
      };
    },
  );

  server.tool(
    "move_email",
    "Move an email from one folder to another.",
    {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      from_folder: z.string().describe("Source IMAP folder path"),
      to_folder: z.string().describe("Destination IMAP folder path"),
    },
    async ({ account: accountName, uid, from_folder, to_folder }) => {
      const account = getAccount(config, accountName);
      await withImap(account, async (client) => {
        await client.mailboxOpen(from_folder, { readOnly: false });
        await client.messageMove([uid], to_folder, { uid: true });
      });
      return {
        content: [{ type: "text", text: `Email UID ${uid} moved from ${from_folder} to ${to_folder}.` }],
      };
    },
  );
}
