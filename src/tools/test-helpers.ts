import pino from "pino";
import type { Config } from "../config.js";
import type { ToolsContext } from "./context.js";

export const testConfig: Config = {
  accounts: {
    main: {
      imap: { host: "imap.test.com", port: 993, secure: true },
      smtp: { host: "smtp.test.com", port: 587, secure: false },
      user: "u@test.com",
      password: "pw",
      fromName: "Test",
    },
  },
  defaultAccount: "main",
};

export function buildTestContext(overrides: Partial<ToolsContext> = {}): ToolsContext {
  return {
    logger: pino({ level: "silent" }),
    config: testConfig,
    ...overrides,
  };
}
