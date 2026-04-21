#!/usr/bin/env node
/**
 * stdio entry for email-mcp.
 * Used by Claude Desktop. For REST + MCP Streamable-HTTP, see ./http_server.ts.
 */
import { createLogger } from "@klapom/mcp-toolkit-ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json" with { type: "json" };
import { loadContext } from "./tools/context.js";
import { registerTools } from "./tools/index.js";

const logger = createLogger(pkg.name);

async function main(): Promise<void> {
  const ctx = loadContext(logger);
  const server = new McpServer({ name: pkg.name, version: pkg.version });
  registerTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(
    {
      version: pkg.version,
      surface: "stdio",
      accounts: Object.keys(ctx.config.accounts),
      defaultAccount: ctx.config.defaultAccount,
    },
    "started",
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    await server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});
