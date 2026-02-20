import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { registerMailSearchTools } from "./mail-search.js";

function makeMockClient(uids: number[], messages: unknown[]) {
  return {
    mailboxOpen: vi.fn(),
    search: vi.fn().mockResolvedValue(uids),
    fetch: vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })()),
  };
}

describe("mail-search", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    registerMailSearchTools(server as never, testConfig);
  });

  it("registers search_emails tool", () => {
    expect(server.tool).toHaveBeenCalledWith("search_emails", expect.any(String), expect.any(Object), expect.any(Function));
  });

  it("returns search results", async () => {
    const msgs = [{
      uid: 1,
      envelope: { from: [{ name: "A", address: "a@t.com" }], subject: "Match", date: new Date("2026-01-01") },
      flags: new Set(),
    }];
    const client = makeMockClient([1], msgs);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("search_emails", { account: "main", query: "test", search_in: "all", folder: "INBOX", limit: 10 }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe("Match");
  });

  it("returns message when no results", async () => {
    const client = makeMockClient([], []);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("search_emails", { account: "main", query: "nothing", search_in: "subject", folder: "INBOX", limit: 10 }) as { content: { text: string }[] };
    expect(result.content[0].text).toContain("No emails found");
  });
});
