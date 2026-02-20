import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockServer, testConfig } from "./test-helpers.js";

const mockSendEmail = vi.fn();
vi.mock("../smtp-client.js", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { registerMailSendTools } from "./mail-send.js";

describe("mail-send", () => {
  const server = createMockServer();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue("<msg@test>");
    registerMailSendTools(server as never, testConfig);
  });

  it("registers send_email and reply_email tools", () => {
    expect(server.tool).toHaveBeenCalledTimes(2);
  });

  it("send_email calls sendEmail and returns messageId", async () => {
    const result = await server.callTool("send_email", { account: "main", to: "r@t.com", subject: "Hi", body: "text" }) as { content: { text: string }[] };
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({ to: "r@t.com", subject: "Hi", text: "text" }),
    );
    expect(result.content[0].text).toContain("<msg@test>");
  });

  it("reply_email passes inReplyTo and references", async () => {
    const result = await server.callTool("reply_email", {
      account: "main", to: "r@t.com", subject: "Re: Hi", body: "reply",
      in_reply_to: "<orig@test>",
    }) as { content: { text: string }[] };
    expect(mockSendEmail).toHaveBeenCalledWith(
      testConfig.accounts.main,
      expect.objectContaining({ inReplyTo: "<orig@test>", references: "<orig@test>" }),
    );
    expect(result.content[0].text).toContain("Reply sent");
  });
});
