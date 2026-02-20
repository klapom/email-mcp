import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { registerMailReadTools } from "./mail-read.js";

function makeRawEmail(body: string, contentType = "text/plain") {
  return `From: Alice <alice@test.com>\r\nTo: Bob <bob@test.com>\r\nSubject: Test\r\nContent-Type: ${contentType}\r\n\r\n${body}`;
}

function makeMultipartEmail(textBody: string, htmlBody: string) {
  const boundary = "----boundary123";
  return [
    `From: Alice <alice@test.com>`,
    `To: Bob <bob@test.com>`,
    `Subject: Test`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain`,
    ``,
    textBody,
    `--${boundary}`,
    `Content-Type: text/html`,
    ``,
    htmlBody,
    `--${boundary}--`,
  ].join("\r\n");
}

function makeMockClient(messages: unknown[]) {
  return {
    mailboxOpen: vi.fn(),
    fetch: vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })()),
    messageFlagsAdd: vi.fn(),
  };
}

describe("mail-read", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    registerMailReadTools(server as never, testConfig);
  });

  it("registers read_email tool", () => {
    expect(server.tool).toHaveBeenCalledWith("read_email", expect.any(String), expect.any(Object), expect.any(Function));
  });

  it("reads a plain text email", async () => {
    const raw = makeRawEmail("Hello world");
    const client = makeMockClient([{
      uid: 42,
      source: Buffer.from(raw),
      envelope: {
        from: [{ name: "Alice", address: "alice@test.com" }],
        to: [{ name: "Bob", address: "bob@test.com" }],
        subject: "Test",
        date: new Date("2026-01-01"),
        messageId: "<msg1@test>",
      },
      bodyStructure: null,
    }]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("read_email", { account: "main", uid: 42, folder: "INBOX", mark_as_read: true }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.body).toBe("Hello world");
    expect(parsed.bodyType).toBe("text");
    expect(client.messageFlagsAdd).toHaveBeenCalled();
  });

  it("reads multipart email, prefers text", async () => {
    const raw = makeMultipartEmail("plain text", "<b>html</b>");
    const client = makeMockClient([{
      uid: 43,
      source: Buffer.from(raw),
      envelope: {
        from: [{ name: "Alice", address: "alice@test.com" }],
        to: [{ name: "Bob", address: "bob@test.com" }],
        subject: "Test",
        date: new Date("2026-01-01"),
        messageId: "<msg2@test>",
      },
      bodyStructure: null,
    }]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("read_email", { account: "main", uid: 43, folder: "INBOX", mark_as_read: false }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.body).toBe("plain text");
    expect(parsed.bodyType).toBe("text");
    expect(client.messageFlagsAdd).not.toHaveBeenCalled();
  });

  it("returns error for missing email", async () => {
    const client = {
      mailboxOpen: vi.fn(),
      fetch: vi.fn().mockReturnValue((async function* () {})()),
      messageFlagsAdd: vi.fn(),
    };
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("read_email", { account: "main", uid: 999, folder: "INBOX", mark_as_read: true }) as { content: { text: string }[]; isError: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("999");
  });

  it("decodes base64 body", async () => {
    const encoded = Buffer.from("Decoded text").toString("base64");
    const raw = `From: a@b.com\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}`;
    const client = makeMockClient([{
      uid: 44,
      source: Buffer.from(raw),
      envelope: { from: [{ address: "a@b.com" }], to: [], subject: "B64", date: new Date(), messageId: "" },
      bodyStructure: null,
    }]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("read_email", { account: "main", uid: 44, folder: "INBOX", mark_as_read: false }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.body).toBe("Decoded text");
  });

  it("decodes quoted-printable body", async () => {
    const raw = `From: a@b.com\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello=20World`;
    const client = makeMockClient([{
      uid: 45,
      source: Buffer.from(raw),
      envelope: { from: [{ address: "a@b.com" }], to: [], subject: "QP", date: new Date(), messageId: "" },
      bodyStructure: null,
    }]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) => fn(client));

    const result = await server.callTool("read_email", { account: "main", uid: 45, folder: "INBOX", mark_as_read: false }) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.body).toBe("Hello World");
  });
});
