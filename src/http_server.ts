#!/usr/bin/env node
/**
 * Dual-surface HTTP entry for email-mcp:
 *   - REST on LISTEN_PORT (default 32200)
 *   - MCP Streamable-HTTP on MCP_PORT (default 33200, path /mcp)
 *
 * For stdio MCP (Claude Desktop), see ./index.ts.
 *
 * Env (see .env.example and ADR-010):
 *   LISTEN_PORT / MCP_PORT       ports (32200 / 33200 per PORT_REGISTRY)
 *   LISTEN_HOST                  bind address (default 0.0.0.0)
 *   EMAIL_ACCOUNTS_FILE          JSON config path (default ~/.email-mcp/accounts.json)
 *   VLM_URL, VLM_MODEL           vision-LM for OCR (default http://localhost:8089, qwen3-vl-8b)
 *   LOG_LEVEL                    pino level (default info)
 */
import { createDualServer, createLogger } from "@klapom/mcp-toolkit-ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json" with { type: "json" };
import { loadContext } from "./tools/context.js";
import { buildRestHandlers, registerTools } from "./tools/index.js";

const REST_PORT = Number(process.env.LISTEN_PORT ?? 32200);
const MCP_PORT = Number(process.env.MCP_PORT ?? 33200);
const HOST = process.env.LISTEN_HOST ?? "0.0.0.0";

const logger = createLogger(pkg.name);
const ctx = loadContext(logger);

const { handlers, names } = buildRestHandlers(ctx);

const buildMcpServer = (): McpServer => {
  const s = new McpServer({ name: pkg.name, version: pkg.version });
  registerTools(s, ctx);
  return s;
};

const server = createDualServer({
  name: pkg.name,
  version: pkg.version,
  host: HOST,
  restPort: REST_PORT,
  mcpPort: MCP_PORT,
  toolNames: names,
  restHandlers: handlers,
  buildMcpServer,
  logger,
});

logger.info(
  {
    accounts: Object.keys(ctx.config.accounts),
    defaultAccount: ctx.config.defaultAccount,
    toolCount: names.length,
  },
  "context loaded",
);

server.start().catch((err: unknown) => {
  logger.fatal({ err }, "fatal startup error");
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "received shutdown signal");
  await server.stop();
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
