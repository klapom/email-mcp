import { vi } from "vitest";
import type { Config } from "../config.js";

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

export function createMockServer() {
  const tools: Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> = {};
  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      tools[name] = { handler };
    }),
    _tools: tools,
    callTool: async (name: string, args: Record<string, unknown>) => {
      return tools[name].handler(args);
    },
  };
}
