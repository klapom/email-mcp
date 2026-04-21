import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";

export function buildMailFlagTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const mark_email: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "mark_email",
    description: "Mark an email as read, unread, flagged, or unflagged.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      folder: z.string().default("INBOX").describe("IMAP folder path"),
      action: z.enum(["read", "unread", "flag", "unflag"]).describe("Action to perform"),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        uid,
        folder,
        action,
      } = args as {
        account: string;
        uid: number;
        folder: string;
        action: "read" | "unread" | "flag" | "unflag";
      };
      const account = getAccount(ctx.config, accountName);
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
  };

  const delete_email: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "delete_email",
    description: "Move an email to Trash (or permanently delete if already in Trash).",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      folder: z.string().default("INBOX").describe("Source IMAP folder"),
      trash_folder: z
        .string()
        .default("Trash")
        .describe("Trash folder name (e.g. Trash, INBOX.Trash, [Gmail]/Trash)"),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        uid,
        folder,
        trash_folder,
      } = args as {
        account: string;
        uid: number;
        folder: string;
        trash_folder: string;
      };
      const account = getAccount(ctx.config, accountName);
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
  };

  const move_email: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "move_email",
    description: "Move an email from one folder to another.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID"),
      from_folder: z.string().describe("Source IMAP folder path"),
      to_folder: z.string().describe("Destination IMAP folder path"),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        uid,
        from_folder,
        to_folder,
      } = args as {
        account: string;
        uid: number;
        from_folder: string;
        to_folder: string;
      };
      const account = getAccount(ctx.config, accountName);
      try {
        let folderCreated = false;
        await withImap(account, async (client) => {
          try {
            await client.status(to_folder, { messages: true });
          } catch {
            await client.mailboxCreate(to_folder);
            folderCreated = true;
          }
          await client.mailboxOpen(from_folder, { readOnly: false });
          await client.messageMove([uid], to_folder, { uid: true });
        });
        const suffix = folderCreated ? " (folder created)" : "";
        return {
          content: [
            {
              type: "text",
              text: `Email UID ${uid} moved from ${from_folder} to ${to_folder}.${suffix}`,
            },
          ],
        };
      } catch (err: unknown) {
        const detail =
          (err as { responseText?: string }).responseText ??
          (err instanceof Error ? err.message : String(err));
        return {
          content: [{ type: "text", text: `Failed to move UID ${uid}: ${detail}` }],
          isError: true,
        };
      }
    },
  };

  const move_emails_bulk: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "move_emails_bulk",
    description:
      "Move multiple emails in a single IMAP operation. Much faster than calling move_email repeatedly. All UIDs must be in the same source folder.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uids: z.array(z.number().int()).describe("List of email UIDs to move"),
      from_folder: z.string().describe("Source IMAP folder path"),
      to_folder: z.string().describe("Destination IMAP folder path"),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        uids,
        from_folder,
        to_folder,
      } = args as {
        account: string;
        uids: number[];
        from_folder: string;
        to_folder: string;
      };
      const account = getAccount(ctx.config, accountName);
      try {
        let folderCreated = false;
        await withImap(account, async (client) => {
          try {
            await client.status(to_folder, { messages: true });
          } catch {
            await client.mailboxCreate(to_folder);
            folderCreated = true;
          }
          await client.mailboxOpen(from_folder, { readOnly: false });
          await client.messageMove(uids, to_folder, { uid: true });
        });
        const suffix = folderCreated ? " (folder created)" : "";
        return {
          content: [
            {
              type: "text",
              text: `${uids.length} emails moved from ${from_folder} to ${to_folder}.${suffix}`,
            },
          ],
        };
      } catch (err: unknown) {
        const detail =
          (err as { responseText?: string }).responseText ??
          (err instanceof Error ? err.message : String(err));
        return {
          content: [{ type: "text", text: `Failed to move ${uids.length} emails: ${detail}` }],
          isError: true,
        };
      }
    },
  };

  return [mark_email, delete_email, move_email, move_emails_bulk];
}
