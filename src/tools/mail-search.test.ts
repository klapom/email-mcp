import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailSearchTools } from "./mail-search.js";

function makeMockClient(uids: number[], messages: unknown[]) {
  return {
    mailboxOpen: vi.fn(),
    search: vi.fn().mockResolvedValue(uids),
    fetch: vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    ),
  };
}

describe("mail-search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const callSearchEmails = async (args: Record<string, unknown>) => {
    const ctx = buildTestContext();
    const [tool] = buildMailSearchTools(ctx);
    return tool!.handler(ctx, args);
  };

  it("exposes search_emails tool", () => {
    const tools = buildMailSearchTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["search_emails"]);
  });

  it("returns search results", async () => {
    const msgs = [
      {
        uid: 1,
        envelope: {
          from: [{ name: "A", address: "a@t.com" }],
          subject: "Match",
          date: new Date("2026-01-01"),
        },
        flags: new Set(),
      },
    ];
    const client = makeMockClient([1], msgs);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callSearchEmails({
      account: "main",
      query: "test",
      search_in: "all",
      folder: "INBOX",
      limit: 10,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe("Match");
  });

  it.each([
    ["subject", { header: ["subject", "x"] }],
    ["from", { header: ["from", "x"] }],
    ["body", { body: "x" }],
  ])("builds correct criteria for search_in=%s", async (search_in) => {
    const client = makeMockClient([], []);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    await callSearchEmails({
      account: "main",
      query: "x",
      search_in,
      folder: "INBOX",
      limit: 10,
    });
    expect(client.search).toHaveBeenCalled();
  });

  it("returns message when no results", async () => {
    const client = makeMockClient([], []);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callSearchEmails({
      account: "main",
      query: "nothing",
      search_in: "subject",
      folder: "INBOX",
      limit: 10,
    });
    expect(result.content[0]!.text).toContain("No emails found");
  });
});
