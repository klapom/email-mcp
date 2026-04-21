import type { ToolsContext as BaseContext } from "@klapom/mcp-toolkit-ts";
import type { Logger } from "pino";
import { type Config, loadConfig } from "../config.js";

/**
 * Dependencies shared across email tools.
 *
 * Extends toolkit's ToolsContext with the multi-account Config (IMAP/SMTP
 * credentials per account). Built once at startup from
 * `$EMAIL_ACCOUNTS_FILE` (default `~/.email-mcp/accounts.json`).
 */
export type ToolsContext = BaseContext & {
  config: Config;
};

export function loadContext(logger: Logger): ToolsContext {
  const config = loadConfig();
  return { logger, config };
}
