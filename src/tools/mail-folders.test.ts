import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { registerMailFolderTools } from "./mail-folders.js";

describe("mail-folders", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    registerMailFolderTools(server as never, testConfig);
  });

  it("registers list_folders tool", () => {
    expect(server.tool).toHaveBeenCalledWith("list_folders", expect.any(String), expect.any(Object), expect.any(Function));
  });

  it("returns folder list", async () => {
    mockWithImap.mockImplementation(async (_acc: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({ list: async () => [{ path: "INBOX", name: "Inbox" }, { path: "Sent", name: "Sent" }] }),
    );
    const result = await server.callTool("list_folders", { account: "main" }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].path).toBe("INBOX");
  });
});
