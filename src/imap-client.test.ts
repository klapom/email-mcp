import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AccountConfig } from "./config.js";

const mockConnect = vi.fn();
const mockLogout = vi.fn();

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    logout: mockLogout,
  })),
}));

import { ImapFlow } from "imapflow";
import { createImapClient, withImap } from "./imap-client.js";

const account: AccountConfig = {
  imap: { host: "imap.test.com", port: 993, secure: true },
  smtp: { host: "smtp.test.com", port: 587, secure: false },
  user: "u@test.com",
  password: "pw",
  fromName: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockLogout.mockResolvedValue(undefined);
});

describe("createImapClient", () => {
  it("creates client with correct config", () => {
    createImapClient(account);
    expect(ImapFlow).toHaveBeenCalledWith({
      host: "imap.test.com",
      port: 993,
      secure: true,
      auth: { user: "u@test.com", pass: "pw" },
      logger: false,
    });
  });
});

describe("withImap", () => {
  it("connects, runs fn, and logs out", async () => {
    const result = await withImap(account, async () => "done");
    expect(mockConnect).toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalled();
    expect(result).toBe("done");
  });

  it("logs out even when fn throws", async () => {
    await expect(
      withImap(account, async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");
    expect(mockLogout).toHaveBeenCalled();
  });
});
