import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountConfig } from "./config.js";

const mockSendMail = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

import nodemailer from "nodemailer";
import { sendEmail } from "./smtp-client.js";

const account: AccountConfig = {
  imap: { host: "imap.test.com", port: 993, secure: true },
  smtp: { host: "smtp.test.com", port: 587, secure: false },
  user: "u@test.com",
  password: "pw",
  fromName: "Test User",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMail.mockResolvedValue({ messageId: "<abc@test>" });
});

describe("sendEmail", () => {
  it("formats from with name when fromName is set", async () => {
    await sendEmail(account, { to: "r@test.com", subject: "Hi", text: "body" });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Test User <u@test.com>" }),
    );
  });

  it("uses bare email when fromName is empty", async () => {
    await sendEmail({ ...account, fromName: "" }, { to: "r@test.com", subject: "Hi", text: "body" });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "u@test.com" }),
    );
  });

  it("returns messageId", async () => {
    const id = await sendEmail(account, { to: "r@test.com", subject: "Hi", text: "body" });
    expect(id).toBe("<abc@test>");
  });

  it("creates transport with correct smtp settings", async () => {
    await sendEmail(account, { to: "r@test.com", subject: "Hi", text: "body" });
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: "smtp.test.com",
      port: 587,
      secure: false,
      auth: { user: "u@test.com", pass: "pw" },
    });
  });

  it("passes cc, bcc, inReplyTo, references", async () => {
    await sendEmail(account, {
      to: "r@test.com",
      subject: "Re: Hi",
      text: "reply",
      cc: "cc@test.com",
      bcc: "bcc@test.com",
      inReplyTo: "<orig@test>",
      references: "<orig@test>",
    });
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: "cc@test.com",
        bcc: "bcc@test.com",
        inReplyTo: "<orig@test>",
        references: "<orig@test>",
      }),
    );
  });
});
