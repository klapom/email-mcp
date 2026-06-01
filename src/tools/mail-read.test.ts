import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailReadTools } from "./mail-read.js";

const envelope = {
  from: [{ name: "Alice", address: "alice@test.com" }],
  to: [{ name: "Bob", address: "bob@test.com" }],
  subject: "Test",
  date: new Date("2026-01-01"),
  messageId: "<msg1@test>",
};

/**
 * Builds a mock ImapFlow client that answers two kinds of fetch:
 *  - structure fetch (envelope + bodyStructure)  -> yields { uid, envelope, bodyStructure }
 *  - bodyParts fetch ({ bodyParts: [...] })       -> yields { uid, bodyParts: Map }
 * bodyParts content is RAW (transfer-encoded), exactly as imapflow returns it.
 */
function makeMockClient(_uid: number, bodyStructure: unknown, bodyParts: Record<string, Buffer>) {
  const fetch = vi.fn((range: number[], query: { bodyParts?: string[]; source?: boolean }) =>
    (async function* () {
      if (query.bodyParts) {
        const m = new Map<string, Buffer>();
        for (const id of query.bodyParts) {
          if (bodyParts[id]) m.set(id, bodyParts[id]);
        }
        yield { uid: range[0], bodyParts: m };
      } else {
        yield { uid: range[0], envelope, bodyStructure };
      }
    })(),
  );
  return { mailboxOpen: vi.fn(), fetch, messageFlagsAdd: vi.fn() };
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

  const wireClient = (client: unknown) =>
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

  it("exposes read_email tool", () => {
    const tools = buildMailReadTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["read_email"]);
  });

  it("reads a plain text email", async () => {
    const client = makeMockClient(
      42,
      { part: "1", type: "text/plain", encoding: "" },
      { "1": Buffer.from("Hello world") },
    );
    wireClient(client);

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
    const client = makeMockClient(
      43,
      {
        type: "multipart/alternative",
        childNodes: [
          { part: "1", type: "text/plain", encoding: "" },
          { part: "2", type: "text/html", encoding: "" },
        ],
      },
      { "1": Buffer.from("plain text"), "2": Buffer.from("<b>html</b>") },
    );
    wireClient(client);

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
    wireClient(client);

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
    const client = makeMockClient(
      44,
      { part: "1", type: "text/plain", encoding: "base64" },
      { "1": Buffer.from(encoded) },
    );
    wireClient(client);

    const result = await callReadEmail({
      account: "main",
      uid: 44,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe("Decoded text");
  });

  it("decodes quoted-printable body", async () => {
    const client = makeMockClient(
      45,
      { part: "1", type: "text/plain", encoding: "quoted-printable" },
      { "1": Buffer.from("Hello=20World") },
    );
    wireClient(client);

    const result = await callReadEmail({
      account: "main",
      uid: 45,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe("Hello World");
  });

  it("reads single-part html email as bodyType html", async () => {
    const client = makeMockClient(
      46,
      { part: "1", type: "text/html", encoding: "" },
      { "1": Buffer.from("<p>Hello</p>") },
    );
    wireClient(client);
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
    const client = makeMockClient(
      47,
      {
        type: "multipart/mixed",
        childNodes: [
          { part: "1", type: "text/plain", encoding: "" },
          {
            part: "2",
            type: "application/pdf",
            encoding: "base64",
            disposition: "attachment",
            dispositionParameters: { filename: "invoice.pdf" },
            parameters: { name: "invoice.pdf" },
            size: 1234,
          },
        ],
      },
      { "1": Buffer.from("hi") },
    );
    wireClient(client);
    const result = await callReadEmail({
      account: "main",
      uid: 47,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("invoice.pdf");
    expect(parsed.attachments[0].size).toBe(1234);
  });

  // #4: nested Outlook multipart with an inline image, plus #2: read_email must
  // not pull attachment bytes (only the text body parts get fetched).
  it("handles nested Outlook multipart with inline image, without fetching attachment bytes", async () => {
    const bodyStructure = {
      type: "multipart/mixed",
      childNodes: [
        {
          type: "multipart/related",
          childNodes: [
            {
              type: "multipart/alternative",
              childNodes: [
                { part: "1.1.1", type: "text/plain", encoding: "" },
                { part: "1.1.2", type: "text/html", encoding: "" },
              ],
            },
            {
              part: "1.2",
              type: "image/jpeg",
              encoding: "base64",
              disposition: "inline",
              dispositionParameters: { filename: "visualisierung_1.jpg" },
              parameters: { name: "visualisierung_1.jpg" },
              size: 50000,
            },
          ],
        },
        {
          part: "2",
          type: "application/pdf",
          encoding: "base64",
          disposition: "attachment",
          dispositionParameters: { filename: "angebot.pdf" },
          size: 900000,
        },
      ],
    };
    const client = makeMockClient(98203, bodyStructure, {
      "1.1.1": Buffer.from("Angebot anbei"),
      "1.1.2": Buffer.from("<p>Angebot anbei</p>"),
    });
    wireClient(client);

    const result = await callReadEmail({
      account: "main",
      uid: 98203,
      folder: "INBOX",
      mark_as_read: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);

    // body found in the deeply nested text/plain part
    expect(parsed.body).toBe("Angebot anbei");
    expect(parsed.bodyType).toBe("text");

    // both the inline JPEG and the PDF attachment are surfaced
    const names = parsed.attachments.map((a: { filename: string }) => a.filename).sort();
    expect(names).toEqual(["angebot.pdf", "visualisierung_1.jpg"]);

    // #2: no fetch ever requested `source`, and the bodyParts fetch only asked
    // for the two text parts — never the 50 KB JPEG or 900 KB PDF.
    const calls = client.fetch.mock.calls;
    expect(calls.some(([, q]) => q.source)).toBe(false);
    const partFetch = calls.find(([, q]) => q.bodyParts);
    expect(partFetch?.[1].bodyParts).toEqual(["1.1.1", "1.1.2"]);
  });
});
