import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { registerMailFlagTools } from "./mail-flag.js";

function makeMockClient() {
  return {
    mailboxOpen: vi.fn(),
    mailboxClose: vi.fn(),
    messageFlagsAdd: vi.fn(),
    messageFlagsRemove: vi.fn(),
    messageMove: vi.fn(),
  };
}

describe("mail-flag", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    registerMailFlagTools(server as never, testConfig);
  });

  it("registers mark_email, delete_email, move_email tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(3);
  });

  it("mark_email read adds \\Seen flag", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    await server.callTool("mark_email", { account: "main", uid: 1, folder: "INBOX", action: "read" });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("mark_email unread removes \\Seen flag", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    await server.callTool("mark_email", { account: "main", uid: 1, folder: "INBOX", action: "unread" });
    expect(client.messageFlagsRemove).toHaveBeenCalledWith([1], ["\\Seen"], { uid: true });
  });

  it("mark_email flag adds \\Flagged", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    await server.callTool("mark_email", { account: "main", uid: 1, folder: "INBOX", action: "flag" });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Flagged"], { uid: true });
  });

  it("delete_email moves to trash", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    await server.callTool("delete_email", { account: "main", uid: 1, folder: "INBOX", trash_folder: "Trash" });
    expect(client.messageMove).toHaveBeenCalledWith([1], "Trash", { uid: true });
  });

  it("delete_email permanently deletes when already in trash", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    await server.callTool("delete_email", { account: "main", uid: 1, folder: "Trash", trash_folder: "Trash" });
    expect(client.messageFlagsAdd).toHaveBeenCalledWith([1], ["\\Deleted"], { uid: true });
    expect(client.mailboxClose).toHaveBeenCalled();
  });

  it("move_email moves between folders", async () => {
    const client = makeMockClient();
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("move_email", { account: "main", uid: 1, from_folder: "INBOX", to_folder: "Archive" }) as { content: { text: string }[] };
    expect(client.messageMove).toHaveBeenCalledWith([1], "Archive", { uid: true });
    expect(result.content[0].text).toContain("moved");
  });
});
