import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailFlagTools } from "./mail-flag.js";

function makeMockClient() {
  return {
    mailboxOpen: vi.fn(),
    mailboxClose: vi.fn(),
    messageFlagsAdd: vi.fn(),
    messageFlagsRemove: vi.fn(),
    messageMove: vi.fn(),
    status: vi.fn(),
    mailboxCreate: vi.fn(),
  };
}

describe("mail-flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes mark_email, delete_email, move_email, move_emails_bulk tools", () => {
    const tools = buildMailFlagTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual([
      "mark_email",
      "delete_email",
      "move_email",
      "move_emails_bulk",
    ]);
  });

  it("mark_email read adds \\Seen flag", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const markEmail = tools.find((t) => t.name === "mark_email")!;
    await markEmail.handler(ctx, {
      account: "main",
      uid: 1,
      folder: "INBOX",
      action: "read",
    });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("mark_email unread removes \\Seen flag", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const markEmail = tools.find((t) => t.name === "mark_email")!;
    await markEmail.handler(ctx, {
      account: "main",
      uid: 1,
      folder: "INBOX",
      action: "unread",
    });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("mark_email flag adds \\Flagged", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const markEmail = tools.find((t) => t.name === "mark_email")!;
    await markEmail.handler(ctx, {
      account: "main",
      uid: 1,
      folder: "INBOX",
      action: "flag",
    });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Flagged"], { uid: true });
  });

  it("delete_email moves to trash", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const deleteEmail = tools.find((t) => t.name === "delete_email")!;
    await deleteEmail.handler(ctx, {
      account: "main",
      uid: 1,
      folder: "INBOX",
      trash_folder: "Trash",
    });
    expect(client.messageMove).toHaveBeenCalledWith([1], "Trash", { uid: true });
  });

  it("delete_email permanently deletes when already in trash", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const deleteEmail = tools.find((t) => t.name === "delete_email")!;
    await deleteEmail.handler(ctx, {
      account: "main",
      uid: 1,
      folder: "Trash",
      trash_folder: "Trash",
    });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Deleted"], { uid: true });
    expect(client.mailboxClose).toHaveBeenCalled();
  });

  it("move_email moves between folders", async () => {
    const client = makeMockClient();
    client.status.mockResolvedValue({ messages: 0 });
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const tools = buildMailFlagTools(ctx);
    const moveEmail = tools.find((t) => t.name === "move_email")!;
    const result = await moveEmail.handler(ctx, {
      account: "main",
      uid: 1,
      from_folder: "INBOX",
      to_folder: "Archive",
    });
    expect(client.messageMove).toHaveBeenCalledWith([1], "Archive", { uid: true });
    expect(result.content[0]!.text).toContain("moved");
  });

  it("move_email auto-creates destination folder when missing", async () => {
    const client = makeMockClient();
    client.status.mockRejectedValue(new Error("no such folder"));
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const moveEmail = buildMailFlagTools(ctx).find((t) => t.name === "move_email")!;
    const result = await moveEmail.handler(ctx, {
      account: "main",
      uid: 1,
      from_folder: "INBOX",
      to_folder: "NewFolder",
    });
    expect(client.mailboxCreate).toHaveBeenCalledWith("NewFolder");
    expect(result.content[0]!.text).toContain("folder created");
  });

  it("move_email returns isError when IMAP throws", async () => {
    const err = new Error("IMAP fail") as Error & { responseText?: string };
    err.responseText = "NO MOVE FAIL";
    mockWithImap.mockRejectedValue(err);
    const ctx = buildTestContext();
    const moveEmail = buildMailFlagTools(ctx).find((t) => t.name === "move_email")!;
    const result = await moveEmail.handler(ctx, {
      account: "main",
      uid: 1,
      from_folder: "INBOX",
      to_folder: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("NO MOVE FAIL");
  });

  it("move_emails_bulk moves list of UIDs", async () => {
    const client = makeMockClient();
    client.status.mockResolvedValue({ messages: 5 });
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const ctx = buildTestContext();
    const bulk = buildMailFlagTools(ctx).find((t) => t.name === "move_emails_bulk")!;
    const result = await bulk.handler(ctx, {
      account: "main",
      uids: [1, 2, 3],
      from_folder: "INBOX",
      to_folder: "Archive",
    });
    expect(client.messageMove).toHaveBeenCalledWith([1, 2, 3], "Archive", { uid: true });
    expect(result.content[0]!.text).toContain("3 emails moved");
  });

  it("move_emails_bulk returns isError on failure", async () => {
    mockWithImap.mockRejectedValue(new Error("bulk fail"));
    const ctx = buildTestContext();
    const bulk = buildMailFlagTools(ctx).find((t) => t.name === "move_emails_bulk")!;
    const result = await bulk.handler(ctx, {
      account: "main",
      uids: [1, 2],
      from_folder: "INBOX",
      to_folder: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("2 emails");
  });
});
