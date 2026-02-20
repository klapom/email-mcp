import { ImapFlow } from "imapflow";
import type { AccountConfig } from "./config.js";

export function createImapClient(account: AccountConfig): ImapFlow {
  return new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth: {
      user: account.user,
      pass: account.password,
    },
    logger: false,
  });
}

export async function withImap<T>(
  account: AccountConfig,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = createImapClient(account);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout();
  }
}
