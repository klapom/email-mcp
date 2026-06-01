import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailListTools } from "./mail-list.js";

function makeMockClient(uids: number[], messages: unknown[]) {
  return {
    mailboxOpen: vi.fn().mockResolvedValue({ exists: uids.length }),
    search: vi.fn().mockResolvedValue(uids),
    fetch: vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    ),
  };
}

describe("mail-list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const callListEmails = async (args: Record<string, unknown>) => {
    const ctx = buildTestContext();
    const [tool] = buildMailListTools(ctx);
    return tool!.handler(ctx, args);
  };

  it("exposes list_emails tool", () => {
    const tools = buildMailListTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["list_emails"]);
  });

  it("returns emails", async () => {
    const msgs = [
      {
        uid: 1,
        envelope: {
          from: [{ name: "Alice", address: "alice@test.com" }],
          subject: "Hello",
          date: new Date("2026-01-01"),
        },
        flags: new Set(["\\Seen"]),
        bodyStructure: null,
      },
    ];
    const client = makeMockClient([1], msgs);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subject).toBe("Hello");
    expect(parsed[0].seen).toBe(true);
  });

  it("returns empty for empty mailbox", async () => {
    const client = { mailboxOpen: vi.fn().mockResolvedValue({ exists: 0 }) };
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual([]);
  });

  it("handles message without envelope.from (unknown sender)", async () => {
    const client = makeMockClient(
      [2],
      [{ uid: 2, envelope: { subject: "S" }, flags: new Set(), bodyStructure: null }],
    );
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed[0].from).toBe("unknown");
    expect(parsed[0].seen).toBe(false);
  });

  it("marks hasAttachments when bodyStructure has attachment disposition", async () => {
    const client = makeMockClient(
      [3],
      [
        {
          uid: 3,
          envelope: {
            from: [{ address: "a@b.com" }],
            subject: "A",
            date: new Date(),
          },
          flags: new Set(["\\Seen"]),
          bodyStructure: {
            childNodes: [{ disposition: "attachment", type: "application/pdf" }],
          },
        },
      ],
    );
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed[0].hasAttachments).toBe(true);
  });

  it("includes attachment metadata (filename/size/type) when present", async () => {
    const client = makeMockClient(
      [4],
      [
        {
          uid: 4,
          envelope: { from: [{ address: "a@b.com" }], subject: "A", date: new Date() },
          flags: new Set(),
          bodyStructure: {
            type: "multipart/mixed",
            childNodes: [
              { part: "1", type: "text/plain", encoding: "" },
              {
                part: "2",
                type: "application/pdf",
                disposition: "attachment",
                dispositionParameters: { filename: "angebot.pdf" },
                size: 90000,
              },
              // inline image — surfaced as attachment via the filename heuristic
              {
                part: "3",
                type: "image/jpeg",
                disposition: "inline",
                dispositionParameters: { filename: "vis.jpg" },
                size: 5000,
              },
            ],
          },
        },
      ],
    );
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed[0].hasAttachments).toBe(true);
    expect(parsed[0].attachments).toEqual([
      { filename: "angebot.pdf", size: 90000, type: "application/pdf" },
      { filename: "vis.jpg", size: 5000, type: "image/jpeg" },
    ]);
  });

  it("returns empty attachments array when none present", async () => {
    const client = makeMockClient(
      [5],
      [
        {
          uid: 5,
          envelope: { from: [{ address: "a@b.com" }], subject: "B", date: new Date() },
          flags: new Set(),
          bodyStructure: { part: "1", type: "text/plain" },
        },
      ],
    );
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed[0].hasAttachments).toBe(false);
    expect(parsed[0].attachments).toEqual([]);
  });

  it("returns empty when search has no results", async () => {
    const client = {
      mailboxOpen: vi.fn().mockResolvedValue({ exists: 5 }),
      search: vi.fn().mockResolvedValue([]),
    };
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callListEmails({
      account: "main",
      folder: "INBOX",
      limit: 20,
      unread_only: true,
    });
    expect(JSON.parse(result.content[0]!.text)).toEqual([]);
  });
});
