import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailAttachmentTools } from "./mail-attachment.js";

/**
 * Mock client: structure fetch yields bodyStructure; bodyParts fetch yields the
 * requested parts as RAW (transfer-encoded) buffers, like imapflow.
 */
function makeMockClient(_uid: number, bodyStructure: unknown, bodyParts: Record<string, Buffer>) {
  const fetch = vi.fn((range: number[], query: { bodyParts?: string[] }) =>
    (async function* () {
      if (query.bodyParts) {
        const m = new Map<string, Buffer>();
        for (const id of query.bodyParts) {
          if (bodyParts[id]) m.set(id, bodyParts[id]);
        }
        yield { uid: range[0], bodyParts: m };
      } else {
        yield { uid: range[0], bodyStructure };
      }
    })(),
  );
  return { mailboxOpen: vi.fn(), fetch };
}

// Nested Outlook structure: text body + inline JPEG + PDF attachment.
const outlookStructure = {
  type: "multipart/mixed",
  childNodes: [
    {
      type: "multipart/related",
      childNodes: [
        {
          type: "multipart/alternative",
          childNodes: [{ part: "1.1.1", type: "text/plain", encoding: "" }],
        },
        {
          part: "1.2",
          type: "image/jpeg",
          encoding: "base64",
          disposition: "inline",
          dispositionParameters: { filename: "visualisierung_1.jpg" },
          parameters: { name: "visualisierung_1.jpg" },
          size: 8,
        },
      ],
    },
    {
      part: "2",
      type: "application/pdf",
      encoding: "base64",
      disposition: "attachment",
      dispositionParameters: { filename: "angebot.pdf" },
      size: 5,
    },
  ],
};

describe("mail-attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const callGetAttachment = async (args: Record<string, unknown>) => {
    const ctx = buildTestContext();
    const [tool] = buildMailAttachmentTools(ctx);
    return tool!.handler(ctx, args);
  };

  const wireClient = (client: unknown) =>
    mockWithImap.mockImplementation(async (_a: unknown, fn: (c: unknown) => Promise<unknown>) =>
      fn(client),
    );

  it("exposes get_attachment tool", () => {
    const tools = buildMailAttachmentTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["get_attachment"]);
  });

  // #4: inline JPEG inside nested multipart/related must be downloadable by filename.
  it("downloads an inline image attachment from a nested Outlook structure", async () => {
    const original = Buffer.from("JPEGDATA");
    const client = makeMockClient(98203, outlookStructure, {
      // raw bodyPart is base64-encoded, as on the wire
      "1.2": Buffer.from(original.toString("base64")),
    });
    wireClient(client);

    const result = await callGetAttachment({
      account: "main",
      uid: 98203,
      folder: "INBOX",
      filename: "visualisierung_1.jpg",
      extract_text: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.filename).toBe("visualisierung_1.jpg");
    expect(parsed.mimeType).toBe("image/jpeg");
    expect(parsed.content).toBe(original.toString("base64"));

    // only part 1.2 was downloaded — not the whole RFC822 source
    const calls = client.fetch.mock.calls;
    expect(calls.some(([, q]) => q.source)).toBe(false);
    expect(calls.find(([, q]) => q.bodyParts)?.[1].bodyParts).toEqual(["1.2"]);
  });

  it("downloads a regular PDF attachment by filename", async () => {
    const original = Buffer.from("%PDF1");
    const client = makeMockClient(98203, outlookStructure, {
      "2": Buffer.from(original.toString("base64")),
    });
    wireClient(client);

    const result = await callGetAttachment({
      account: "main",
      uid: 98203,
      folder: "INBOX",
      filename: "angebot.pdf",
      extract_text: false,
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.filename).toBe("angebot.pdf");
    expect(parsed.mimeType).toBe("application/pdf");
    expect(parsed.content).toBe(original.toString("base64"));
  });

  it("returns error when attachment filename is unknown", async () => {
    const client = makeMockClient(98203, outlookStructure, {});
    wireClient(client);
    const result = await callGetAttachment({
      account: "main",
      uid: 98203,
      folder: "INBOX",
      filename: "nope.pdf",
      extract_text: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("nope.pdf");
  });

  it("returns error when email is not found", async () => {
    const client = {
      mailboxOpen: vi.fn(),
      fetch: vi.fn().mockReturnValue((async function* () {})()),
    };
    wireClient(client);
    const result = await callGetAttachment({
      account: "main",
      uid: 555,
      folder: "INBOX",
      filename: "x.pdf",
      extract_text: false,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("555");
  });
});
