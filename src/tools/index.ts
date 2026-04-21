import type { RestHandler, ToolDef, ToolResult } from "@klapom/mcp-toolkit-ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolsContext } from "./context.js";
import { buildMailAttachmentTools } from "./mail-attachment.js";
import { buildMailFlagTools } from "./mail-flag.js";
import { buildMailFolderTools } from "./mail-folders.js";
import { buildMailListTools } from "./mail-list.js";
import { buildMailReadTools } from "./mail-read.js";
import { buildMailSearchTools } from "./mail-search.js";
import { buildMailSendTools } from "./mail-send.js";

export function buildAllTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  return [
    ...buildMailListTools(ctx),
    ...buildMailReadTools(ctx),
    ...buildMailSearchTools(ctx),
    ...buildMailFolderTools(ctx),
    ...buildMailFlagTools(ctx),
    ...buildMailSendTools(ctx),
    ...buildMailAttachmentTools(ctx),
  ];
}

export function registerTools(server: McpServer, ctx: ToolsContext): void {
  for (const def of buildAllTools(ctx)) {
    server.tool(def.name, def.description, def.shape, (args: unknown) =>
      def.handler(ctx, args as never),
    );
  }
}

export function buildRestHandlers(ctx: ToolsContext): {
  handlers: Record<string, RestHandler>;
  names: string[];
} {
  const tools = buildAllTools(ctx);
  const handlers: Record<string, RestHandler> = {};
  const names: string[] = [];
  for (const def of tools) {
    names.push(def.name);
    handlers[def.name] = async (rawArgs): Promise<ToolResult> => {
      const parsed = z.object(def.shape).parse(rawArgs ?? {});
      return def.handler(ctx, parsed as never);
    };
  }
  return { handlers, names };
}
