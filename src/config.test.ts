import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadConfig, getAccount, accountParam } from "./config.js";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: () => "/fakehome",
}));

import { readFileSync } from "fs";

const validConfig = {
  accounts: {
    main: {
      imap: { host: "imap.example.com", port: 993, secure: true },
      smtp: { host: "smtp.example.com", port: 587, secure: false },
      user: "user@example.com",
      password: "secret",
      fromName: "Test User",
    },
    work: {
      imap: { host: "imap.work.com", port: 993, secure: true },
      smtp: { host: "smtp.work.com", port: 587, secure: false },
      user: "me@work.com",
      password: "pass2",
      fromName: "",
    },
  },
  defaultAccount: "main",
};

beforeEach(() => {
  vi.mocked(readFileSync).mockReset();
  delete process.env.EMAIL_ACCOUNTS_FILE;
});

describe("loadConfig", () => {
  it("loads a valid config", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));
    const cfg = loadConfig();
    expect(cfg.accounts.main.user).toBe("user@example.com");
    expect(cfg.defaultAccount).toBe("main");
  });

  it("sets defaultAccount to first key if not specified", () => {
    const noDefault = { accounts: validConfig.accounts };
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(noDefault));
    const cfg = loadConfig();
    expect(cfg.defaultAccount).toBe("main");
  });

  it("throws when file cannot be read", () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(() => loadConfig()).toThrow("Cannot read accounts config");
  });

  it("throws on invalid JSON schema", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ accounts: { bad: {} } }));
    expect(() => loadConfig()).toThrow("Invalid accounts config");
  });

  it("throws when no accounts defined", () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ accounts: {} }));
    expect(() => loadConfig()).toThrow("No accounts defined");
  });

  it("uses EMAIL_ACCOUNTS_FILE env var", () => {
    process.env.EMAIL_ACCOUNTS_FILE = "/custom/path.json";
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));
    loadConfig();
    expect(readFileSync).toHaveBeenCalledWith("/custom/path.json", "utf-8");
  });

  it("applies defaults for port/secure", () => {
    const minimal = {
      accounts: {
        test: {
          imap: { host: "imap.test.com" },
          smtp: { host: "smtp.test.com" },
          user: "u@test.com",
          password: "p",
        },
      },
    };
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(minimal));
    const cfg = loadConfig();
    expect(cfg.accounts.test.imap.port).toBe(993);
    expect(cfg.accounts.test.imap.secure).toBe(true);
    expect(cfg.accounts.test.smtp.port).toBe(587);
    expect(cfg.accounts.test.smtp.secure).toBe(false);
    expect(cfg.accounts.test.fromName).toBe("");
  });
});

describe("getAccount", () => {
  const config = loadConfigHelper();

  it("returns named account", () => {
    expect(getAccount(config, "work").user).toBe("me@work.com");
  });

  it("returns default account when name omitted", () => {
    expect(getAccount(config).user).toBe("user@example.com");
  });

  it("throws for unknown account", () => {
    expect(() => getAccount(config, "nope")).toThrow('Unknown account "nope"');
  });
});

describe("accountParam", () => {
  const config = loadConfigHelper();

  it("returns description with account names and default", () => {
    const p = accountParam(config);
    expect(p.defaultName).toBe("main");
    expect(p.description).toContain("main");
    expect(p.description).toContain("work");
  });
});

function loadConfigHelper() {
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(validConfig));
  return loadConfig();
}
