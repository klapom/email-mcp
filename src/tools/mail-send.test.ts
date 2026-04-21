import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext, testConfig } from "./test-helpers.js";

const mockSendEmail = vi.fn();
vi.mock("../upstream/smtp-client.js", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { buildMailSendTools } from "./mail-send.js";

describe("mail-send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue("<msg@test>");
  });

  it("exposes send_email, reply_email, save_draft tools", () => {
    const tools = buildMailSendTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["send_email", "reply_email", "save_draft"]);
  });

  it("send_email calls sendEmail and returns messageId", async () => {
    const ctx = buildTestContext();
    const tools = buildMailSendTools(ctx);
    const sendEmailTool = tools.find((t) => t.name === "send_email")!;
    const result = await sendEmailTool.handler(ctx, {
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

  it("reply_email passes inReplyTo and references", async () => {
    const ctx = buildTestContext();
    const tools = buildMailSendTools(ctx);
    const replyEmail = tools.find((t) => t.name === "reply_email")!;
    const result = await replyEmail.handler(ctx, {
      account: "main",
      to: "r@t.com",
      subject: "Re: Hi",
      body: "reply",
      in_reply_to: "<orig@test>",
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({ inReplyTo: "<orig@test>", references: "<orig@test>" }),
    );
    expect(result.content[0]!.text).toContain("Reply sent");
  });
});
