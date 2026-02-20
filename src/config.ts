import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { z } from "zod";

const AccountSchema = z.object({
  imap: z.object({
    host: z.string(),
    port: z.number().int().default(993),
    secure: z.boolean().default(true),
  }),
  smtp: z.object({
    host: z.string(),
    port: z.number().int().default(587),
    secure: z.boolean().default(false),
  }),
  user: z.string(),
  password: z.string(),
  fromName: z.string().default(""),
  description: z.string().optional(),
});

const ConfigSchema = z.object({
  accounts: z.record(z.string(), AccountSchema),
  defaultAccount: z.string().optional(),
});

export type AccountConfig = z.infer<typeof AccountSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const configPath =
    process.env.EMAIL_ACCOUNTS_FILE ??
    join(homedir(), ".email-mcp", "accounts.json");

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot read accounts config at ${configPath}: ${msg}\n` +
        `Create it or set EMAIL_ACCOUNTS_FILE env var.`,
    );
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join(".")}: ${e.message}`)
      .join("\n");
    throw new Error(`Invalid accounts config:\n${errors}`);
  }

  const config = result.data;
  if (Object.keys(config.accounts).length === 0) {
    throw new Error("No accounts defined in config.");
  }

  // Set defaultAccount to first key if not specified
  if (!config.defaultAccount) {
    config.defaultAccount = Object.keys(config.accounts)[0];
  }

  return config;
}

export function getAccount(config: Config, name?: string): AccountConfig {
  const key = name ?? config.defaultAccount ?? Object.keys(config.accounts)[0];
  const account = config.accounts[key];
  if (!account) {
    const available = Object.keys(config.accounts).join(", ");
    throw new Error(
      `Unknown account "${key}". Available accounts: ${available}`,
    );
  }
  return account;
}

export function accountParam(config: Config) {
  const names = Object.keys(config.accounts);
  const defaultName = config.defaultAccount ?? names[0];
  return {
    description: `Account name to use. Available: ${names.join(", ")}. Default: ${defaultName}`,
    defaultName,
  };
}
