import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailReadTools } from "./mail-read.js";

function makeRawEmail(body: string, contentType = "text/plain") {
  return `From: Alice <alice@test.com>\r\nTo: Bob <bob@test.com>\r\nSubject: Test\r\nContent-Type: ${contentType}\r\n\r\n${body}`;
}

function makeMultipartEmail(textBody: string, htmlBody: string) {
  const boundary = "----boundary123";
  return [
    "From: Alice <alice@test.com>",
    "To: Bob <bob@test.com>",
    "Subject: Test",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    textBody,
    `--${boundary}`,
    "Content-Type: text/html",
    "",
    htmlBody,
    `--${boundary}--`,
  ].join("\r\n");
}

function makeMockClient(messages: unknown[]) {
  return {
    mailboxOpen: vi.fn(),
    fetch: vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    ),
    messageFlagsAdd: vi.fn(),
  };
}

describe("mail-read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const callReadEmail = async (args: Record<string, unknown>) => {
    const ctx = buildTestContext();
    const [tool] = buildMailReadTools(ctx);
    return tool!.handler(ctx, args);
  };

  it("exposes read_email tool", () => {
    const tools = buildMailReadTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["read_email"]);
  });

  it("reads a plain text email", async () => {
    const raw = makeRawEmail("Hello world");
    const client = makeMockClient([
      {
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
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callReadEmail({
      account: "main",
      uid: 42,
      folder: "INBOX",
      mark_as_read: true,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe("Hello world");
    expect(parsed.bodyType).toBe("text");
    expect(client.messageFlagsAdd).toHaveBeenCalled();
  });

  it("reads multipart email, prefers text", async () => {
    const raw = makeMultipartEmail("plain text", "<b>html</b>");
    const client = makeMockClient([
      {
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
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callReadEmail({
      account: "main",
      uid: 43,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
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
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callReadEmail({
      account: "main",
      uid: 999,
      folder: "INBOX",
      mark_as_read: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("999");
  });

  it("decodes base64 body", async () => {
    const encoded = Buffer.from("Decoded text").toString("base64");
    const raw = `From: a@b.com\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}`;
    const client = makeMockClient([
      {
        uid: 44,
        source: Buffer.from(raw),
        envelope: {
          from: [{ address: "a@b.com" }],
          to: [],
          subject: "B64",
          date: new Date(),
          messageId: "",
        },
        bodyStructure: null,
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callReadEmail({
      account: "main",
      uid: 44,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe("Decoded text");
  });

  it("reads plain-html single-part email as bodyType html", async () => {
    const raw = "From: a@b.com\r\nContent-Type: text/html\r\n\r\n<p>Hello</p>";
    const client = makeMockClient([
      {
        uid: 46,
        source: Buffer.from(raw),
        envelope: {
          from: [{ address: "a@b.com" }],
          to: [],
          subject: "H",
          date: new Date(),
          messageId: "",
        },
        bodyStructure: null,
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callReadEmail({
      account: "main",
      uid: 46,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toContain("<p>Hello</p>");
    expect(parsed.bodyType).toBe("html");
  });

  it("extracts attachments from multipart email", async () => {
    const boundary = "----b";
    const raw = [
      "From: a@b.com",
      "To: c@d.com",
      "Subject: A",
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain",
      "",
      "hi",
      `--${boundary}`,
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      "",
      "binary-blob",
      `--${boundary}--`,
    ].join("\r\n");
    const client = makeMockClient([
      {
        uid: 47,
        source: Buffer.from(raw),
        envelope: {
          from: [{ address: "a@b.com" }],
          to: [{ address: "c@d.com" }],
          subject: "A",
          date: new Date(),
          messageId: "<a@b>",
        },
        bodyStructure: null,
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );
    const result = await callReadEmail({
      account: "main",
      uid: 47,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("invoice.pdf");
  });

  it("decodes quoted-printable body", async () => {
    const raw =
      "From: a@b.com\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello=20World";
    const client = makeMockClient([
      {
        uid: 45,
        source: Buffer.from(raw),
        envelope: {
          from: [{ address: "a@b.com" }],
          to: [],
          subject: "QP",
          date: new Date(),
          messageId: "",
        },
        bodyStructure: null,
      },
    ]);
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

    const result = await callReadEmail({
      account: "main",
      uid: 45,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe("Hello World");
  });
});
