import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestContext } from "./test-helpers.js";

const mockWithImap = vi.fn();
vi.mock("../upstream/imap-client.js", () => ({
  withImap: (...args: unknown[]) => mockWithImap(...args),
}));

import { buildMailFolderTools } from "./mail-folders.js";

describe("mail-folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes list_folders tool", () => {
    const tools = buildMailFolderTools(buildTestContext());
    expect(tools.map((t) => t.name)).toEqual(["list_folders"]);
  });

  it("returns folder list", async () => {
    mockWithImap.mockImplementation(
      async (_acc: unknown, fn: (client: unknown) => Promise<unknown>) =>
        fn({
          list: async () => [
            { path: "INBOX", name: "Inbox" },
            { path: "Sent", name: "Sent" },
          ],
        }),
    );
    const ctx = buildTestContext();
    const [tool] = buildMailFolderTools(ctx);
    const result = await tool!.handler(ctx, { account: "main" });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].path).toBe("INBOX");
  });
});
