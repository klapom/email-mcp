import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext, testConfig } from "./test-helpers.js";

const mockSendEmail = vi.fn();
vi.mock("../upstream/smtp-client.js", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// save_draft builds the raw message with nodemailer's streamTransport and
// appends it via withImap — both mocked here so the handler is testable.
const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: mockSendMail }),
  },
}));

const mockAppend = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (_account: unknown, fn: (client: unknown) => unknown) => fn({ append: mockAppend }),
}));

import { buildMailSendTools } from "./mail-send.js";

describe("mail-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue("<msg@test>");
    // nodemailer.sendMail(opts, cb) → hand back a readable stream as info.message
    mockSendMail.mockImplementation(
      (_opts: unknown, cb: (err: Error | null, info: { message: Readable }) => void) => {
        cb(null, { message: Readable.from([Buffer.from("RAW-DRAFT-BYTES")]) });
      },
    );
    mockAppend.mockResolvedValue({ uid: 42 });
  });

  const tool = (name: string) => {
    const ctx = buildTestContext();
    const t = buildMailSendTools(ctx).find((x) => x.name === name);
    if (!t) throw new Error(`tool ${name} not found`);
    return { ctx, t };
  };

  it("exposes send_email, reply_email, save_draft tools", () => {
    const tools = buildMailSendTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["send_email", "reply_email", "save_draft"]);
  });

  it("all three tools advertise an attachments parameter", () => {
    const tools = buildMailSendTools(buildTestContext());
    for (const name of ["send_email", "reply_email", "save_draft"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(Object.keys(t.shape)).toContain("attachments");
    }
  });

  it("send_email calls sendEmail and returns messageId", async () => {
    const { ctx, t } = tool("send_email");
    const result = await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Hi",
      body: "text",
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({ to: "r@t.com", subject: "Hi", text: "text" }),
    );
    expect(result.content[0]!.text).toContain("<msg@test>");
  });

  it("send_email without attachments passes attachments: undefined", async () => {
    const { ctx, t } = tool("send_email");
    await t.handler(ctx, { account: "main", to: "r@t.com", subject: "Hi", body: "x" });
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({ attachments: undefined }),
    );
  });

  it("send_email normalises a string path attachment to {path}", async () => {
    const { ctx, t } = tool("send_email");
    await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Hi",
      body: "x",
      attachments: ["/tmp/report.pdf"],
    });
    const opts = mockSendEmail.mock.calls[0]![1] as { attachments: unknown[] };
    expect(opts.attachments).toEqual([{ path: "/tmp/report.pdf" }]);
  });

  it("send_email normalises a {filename, path} attachment", async () => {
    const { ctx, t } = tool("send_email");
    await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Hi",
      body: "x",
      attachments: [{ filename: "doc.pdf", path: "/tmp/a.pdf" }],
    });
    const opts = mockSendEmail.mock.calls[0]![1] as { attachments: unknown[] };
    expect(opts.attachments).toEqual([{ filename: "doc.pdf", path: "/tmp/a.pdf" }]);
  });

  it("send_email decodes a {filename, content_base64} attachment into a Buffer", async () => {
    const { ctx, t } = tool("send_email");
    const b64 = Buffer.from("hello pdf").toString("base64");
    await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Hi",
      body: "x",
      attachments: [{ filename: "inline.pdf", content_base64: b64 }],
    });
    const opts = mockSendEmail.mock.calls[0]![1] as {
      attachments: Array<{ filename: string; content: Buffer }>;
    };
    expect(opts.attachments[0]!.filename).toBe("inline.pdf");
    expect(Buffer.isBuffer(opts.attachments[0]!.content)).toBe(true);
    expect(opts.attachments[0]!.content.toString()).toBe("hello pdf");
  });

  it("send_email passes multiple mixed attachments through in order", async () => {
    const { ctx, t } = tool("send_email");
    await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Hi",
      body: "x",
      attachments: ["/tmp/one.pdf", { filename: "two.txt", path: "/tmp/two.txt" }],
    });
    const opts = mockSendEmail.mock.calls[0]![1] as { attachments: unknown[] };
    expect(opts.attachments).toHaveLength(2);
    expect(opts.attachments[0]).toEqual({ path: "/tmp/one.pdf" });
  });

  it("reply_email passes inReplyTo, references and attachments", async () => {
    const { ctx, t } = tool("reply_email");
    const result = await t.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Re: Hi",
      body: "reply",
      in_reply_to: "<orig@test>",
      attachments: ["/tmp/r.pdf"],
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({
        inReplyTo: "<orig@test>",
        references: "<orig@test>",
        attachments: [{ path: "/tmp/r.pdf" }],
      }),
    );
    expect(result.content[0]!.text).toContain("Reply sent");
  });

  describe("save_draft", () => {
    it("appends to the default 'Drafts' folder and reports the UID", async () => {
      const { ctx, t } = tool("save_draft");
      const result = await t.handler(ctx, {
        account: "main",
        to: "r@t.com",
        subject: "Entwurf",
        body: "text",
      });
      expect(mockAppend).toHaveBeenCalledWith("Drafts", expect.any(Buffer), ["\\Draft", "\\Seen"]);
      expect(result.content[0]!.text).toContain('Draft saved to "Drafts"');
      expect(result.content[0]!.text).toContain("UID 42");
    });

    it("honours a custom draft_folder (e.g. GMX 'Entwürfe')", async () => {
      const { ctx, t } = tool("save_draft");
      await t.handler(ctx, {
        account: "main",
        to: "r@t.com",
        subject: "x",
        body: "y",
        draft_folder: "Entwürfe",
      });
      expect(mockAppend).toHaveBeenCalledWith("Entwürfe", expect.any(Buffer), [
        "\\Draft",
        "\\Seen",
      ]);
    });

    it("passes normalised attachments into the drafted message", async () => {
      const { ctx, t } = tool("save_draft");
      await t.handler(ctx, {
        account: "main",
        to: "r@t.com",
        subject: "x",
        body: "y",
        attachments: [{ filename: "a.pdf", path: "/tmp/a.pdf" }],
      });
      const draftOpts = mockSendMail.mock.calls[0]![0] as { attachments: unknown[] };
      expect(draftOpts.attachments).toEqual([{ filename: "a.pdf", path: "/tmp/a.pdf" }]);
    });

    it("builds the message with no attachments when none are given", async () => {
      const { ctx, t } = tool("save_draft");
      await t.handler(ctx, { account: "main", to: "r@t.com", subject: "x", body: "y" });
      const draftOpts = mockSendMail.mock.calls[0]![0] as { attachments?: unknown };
      expect(draftOpts.attachments).toBeUndefined();
    });

    it("omits the UID note when append returns no uid", async () => {
      mockAppend.mockResolvedValue(undefined);
      const { ctx, t } = tool("save_draft");
      const result = await t.handler(ctx, {
        account: "main",
        to: "r@t.com",
        subject: "x",
        body: "y",
      });
      expect(result.content[0]!.text).toBe('Draft saved to "Drafts". Subject: "x"');
      expect(result.content[0]!.text).not.toContain("UID");
    });

    it("rejects when nodemailer returns no readable stream", async () => {
      mockSendMail.mockImplementation(
        (_opts: unknown, cb: (err: Error | null, info: { message: unknown }) => void) => {
          cb(null, { message: undefined });
        },
      );
      const { ctx, t } = tool("save_draft");
      await expect(
        t.handler(ctx, { account: "main", to: "r@t.com", subject: "x", body: "y" }),
      ).rejects.toThrow("did not return a readable stream");
    });

    it("propagates a nodemailer sendMail error", async () => {
      mockSendMail.mockImplementation((_opts: unknown, cb: (err: Error | null) => void) =>
        cb(new Error("smtp boom")),
      );
      const { ctx, t } = tool("save_draft");
      await expect(
        t.handler(ctx, { account: "main", to: "r@t.com", subject: "x", body: "y" }),
      ).rejects.toThrow("smtp boom");
    });

    it("falls back to the bare user address when fromName is unset", async () => {
      const cfg = {
        accounts: { main: { ...testConfig.accounts.main, fromName: undefined } },
        defaultAccount: "main",
      };
      const ctx = buildTestContext({ config: cfg as typeof testConfig });
      const t = buildMailSendTools(ctx).find((x) => x.name === "save_draft")!;
      await t.handler(ctx, { account: "main", to: "r@t.com", subject: "x", body: "y" });
      const draftOpts = mockSendMail.mock.calls[0]![0] as { from: string };
      expect(draftOpts.from).toBe("u@test.com");
    });
  });
});
