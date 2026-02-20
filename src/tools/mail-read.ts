import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Config, accountParam, getAccount } from "../config.js";
import { withImap } from "../imap-client.js";

export function registerMailReadTools(server: McpServer, config: Config) {
  const { description, defaultName } = accountParam(config);

  server.tool(
    "read_email",
    "Read the full content of an email by its UID.",
    {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID from list_emails"),
      folder: z.string().default("INBOX").describe("IMAP folder path"),
      mark_as_read: z.boolean().default(true).describe("Mark as read after fetching"),
    },
    async ({ account: accountName, uid, folder, mark_as_read }) => {
      const account = getAccount(config, accountName);
      const email = await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: false });

        let textBody = "";
        let htmlBody = "";
        const attachments: { filename: string; size: number; type: string }[] = [];

        for await (const msg of client.fetch(
          [uid],
          { envelope: true, bodyStructure: true, source: true },
          { uid: true },
        )) {
          const raw = msg.source?.toString("utf-8") ?? "";
          const headerEnd = raw.indexOf("\r\n\r\n");
          const headers = headerEnd > -1 ? raw.slice(0, headerEnd) : "";
          const bodyRaw = headerEnd > -1 ? raw.slice(headerEnd + 4) : raw;

          const contentType = getHeader(headers, "Content-Type") ?? "";
          const boundary = getBoundary(contentType);

          if (boundary) {
            const parts = splitMultipart(bodyRaw, boundary);
            for (const part of parts) {
              const partHeaderEnd = part.indexOf("\r\n\r\n");
              const partHeaders = partHeaderEnd > -1 ? part.slice(0, partHeaderEnd) : "";
              const partBody = partHeaderEnd > -1 ? part.slice(partHeaderEnd + 4) : part;
              const partType = getHeader(partHeaders, "Content-Type") ?? "";
              const disposition = getHeader(partHeaders, "Content-Disposition") ?? "";
              const encoding = getHeader(partHeaders, "Content-Transfer-Encoding") ?? "";

              if (disposition.toLowerCase().includes("attachment")) {
                const filename =
                  getParam(disposition, "filename") ??
                  getParam(partType, "name") ??
                  "unknown";
                attachments.push({
                  filename,
                  size: partBody.length,
                  type: partType.split(";")[0].trim(),
                });
              } else if (partType.toLowerCase().includes("text/plain") && !textBody) {
                textBody = decodeBody(partBody, encoding);
              } else if (partType.toLowerCase().includes("text/html") && !htmlBody) {
                htmlBody = decodeBody(partBody, encoding);
              }
            }
          } else if (contentType.toLowerCase().includes("text/plain")) {
            textBody = decodeBody(bodyRaw, getHeader(headers, "Content-Transfer-Encoding") ?? "");
          } else if (contentType.toLowerCase().includes("text/html")) {
            htmlBody = decodeBody(bodyRaw, getHeader(headers, "Content-Transfer-Encoding") ?? "");
          }

          if (mark_as_read) {
            await client.messageFlagsAdd([uid], ["\\Seen"], { uid: true });
          }

          const from = msg.envelope?.from?.[0]
            ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address}>`.trim()
            : "unknown";
          const to =
            msg.envelope?.to
              ?.map((a) => `${a.name ?? ""} <${a.address}>`.trim())
              .join(", ") ?? "";

          return {
            uid: msg.uid,
            from,
            to,
            subject: msg.envelope?.subject ?? "(no subject)",
            date: msg.envelope?.date?.toISOString() ?? "",
            messageId: msg.envelope?.messageId ?? "",
            body: textBody || htmlBody || "(no text body)",
            bodyType: textBody ? "text" : "html",
            attachments,
          };
        }
        return null;
      });

      if (!email) {
        return {
          content: [{ type: "text", text: `Email UID ${uid} not found.` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(email, null, 2) }] };
    },
  );
}

function getHeader(headers: string, name: string): string | undefined {
  const re = new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n[^\\s]|$)`, "im");
  const m = re.exec(headers);
  return m ? m[1].replace(/\r?\n\s+/g, " ").trim() : undefined;
}

function getBoundary(contentType: string): string | undefined {
  return getParam(contentType, "boundary");
}

function getParam(header: string, param: string): string | undefined {
  const re = new RegExp(`${param}="?([^";\\r\\n]+)"?`, "i");
  const m = re.exec(header);
  return m ? m[1].trim() : undefined;
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts = body.split(new RegExp(`\\r?\\n?${escapeRegex(delimiter)}[\\r\\n]*`));
  return parts.slice(1).filter((p) => !p.startsWith("--"));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeBody(body: string, encoding: string): string {
  const enc = encoding.toLowerCase().trim();
  if (enc === "base64") {
    try {
      return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf-8");
    } catch {
      return body;
    }
  }
  if (enc === "quoted-printable") {
    return body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
  }
  return body;
}
