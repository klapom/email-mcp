import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { registerMailListTools } from "./mail-list.js";

function makeMockClient(uids: number[], messages: unknown[]) {
  return {
    mailboxOpen: vi.fn().mockResolvedValue({ exists: uids.length }),
    search: vi.fn().mockResolvedValue(uids),
    fetch: vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })()),
  };
}

describe("mail-list", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    registerMailListTools(server as never, testConfig);
  });

  it("registers list_emails tool", () => {
    expect(server.tool).toHaveBeenCalledWith("list_emails", expect.any(String), expect.any(Object), expect.any(Function));
  });

  it("returns emails", async () => {
    const msgs = [{
      uid: 1,
      envelope: {
        from: [{ name: "Alice", address: "alice@test.com" }],
        subject: "Hello",
        date: new Date("2026-01-01"),
      },
      flags: new Set(["\\Seen"]),
      bodyStructure: null,
    }];
    const client = makeMockClient([1], msgs);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("list_emails", { account: "main", folder: "INBOX", limit: 20, unread_only: false }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe("Hello");
    expect(parsed[0].seen).toBe(true);
  });

  it("returns empty for empty mailbox", async () => {
    const client = { mailboxOpen: vi.fn().mockResolvedValue({ exists: 0 }) };
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("list_emails", { account: "main", folder: "INBOX", limit: 20, unread_only: false }) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });

  it("returns empty when search has no results", async () => {
    const client = {
      mailboxOpen: vi.fn().mockResolvedValue({ exists: 5 }),
      search: vi.fn().mockResolvedValue([]),
    };
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("list_emails", { account: "main", folder: "INBOX", limit: 20, unread_only: true }) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});
