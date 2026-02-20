import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerMailFlagTools } from "./tools/mail-flag.js";
import { registerMailFolderTools } from "./tools/mail-folders.js";
import { registerMailListTools } from "./tools/mail-list.js";
import { registerMailReadTools } from "./tools/mail-read.js";
import { registerMailSearchTools } from "./tools/mail-search.js";
import { registerMailSendTools } from "./tools/mail-send.js";

const VERSION = "0.2.0";

const server = new McpServer({
  name: "email-mcp",
  version: VERSION,
});

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[email-mcp] Config error: ${msg}\n`);
    process.exit(1);
  }

  registerMailFolderTools(server, config);
  registerMailListTools(server, config);
  registerMailReadTools(server, config);
  registerMailSearchTools(server, config);
  registerMailSendTools(server, config);
  registerMailFlagTools(server, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const accountNames = Object.keys(config.accounts).join(", ");
  process.stderr.write(
    `[email-mcp] v${VERSION} started. Accounts: ${accountNames} (default: ${config.defaultAccount})\n`,
  );

  const shutdown = async (signal: string) => {
    process.stderr.write(`[email-mcp] Shutting down (${signal})...\n`);
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  process.stderr.write(
    `[email-mcp] Fatal: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
