import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { z, ZodRawShape } from "zod";
import { loadConfig } from "./config.js";
import { registerMailAttachmentTools } from "./tools/mail-attachment.js";
import { registerMailFlagTools } from "./tools/mail-flag.js";
import { registerMailFolderTools } from "./tools/mail-folders.js";
import { registerMailListTools } from "./tools/mail-list.js";
import { registerMailReadTools } from "./tools/mail-read.js";
import { registerMailSearchTools } from "./tools/mail-search.js";
import { registerMailSendTools } from "./tools/mail-send.js";

const VERSION = "0.2.0-http";
const PORT = parseInt(process.env.HTTP_PORT ?? "8201", 10);
const HOST = process.env.HTTP_HOST ?? "0.0.0.0";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}>;

interface RegisteredTool {
  name: string;
  description: string;
  schema: z.ZodObject<ZodRawShape>;
  handler: ToolHandler;
}

const tools = new Map<string, RegisteredTool>();

// Mock McpServer compatible with server.tool(name, desc, shape, handler).
const mockServer = {
  tool(
    name: string,
    description: string,
    shape: ZodRawShape,
    handler: ToolHandler,
  ) {
    const schema = z.object(shape);
    tools.set(name, { name, description, schema, handler });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const config = loadConfig();

registerMailAttachmentTools(mockServer, config);
registerMailFolderTools(mockServer, config);
registerMailListTools(mockServer, config);
registerMailReadTools(mockServer, config);
registerMailSearchTools(mockServer, config);
registerMailSendTools(mockServer, config);
registerMailFlagTools(mockServer, config);

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          resolve(parsed as Record<string, unknown>);
        } else {
          reject(new Error("JSON body must be an object"));
        }
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET" && url === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "email-mcp-http",
      version: VERSION,
      accounts: Object.keys(config.accounts),
      defaultAccount: config.defaultAccount,
    });
  }

  if (method === "GET" && url === "/tools") {
    return sendJson(res, 200, {
      tools: Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
      })),
    });
  }

  if (method === "POST" && url.startsWith("/tools/")) {
    const name = url.slice("/tools/".length).split("?")[0];
    const tool = tools.get(name);
    if (!tool) {
      return sendJson(res, 404, { ok: false, error: `unknown tool: ${name}` });
    }
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch (e) {
      return sendJson(res, 400, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    const parsed = tool.schema.safeParse(body);
    if (!parsed.success) {
      return sendJson(res, 400, {
        ok: false,
        error: "validation failed",
        issues: parsed.error.errors,
      });
    }
    try {
      const result = await tool.handler(parsed.data);
      // MCP output: { content: [{type:"text", text: "..."}], isError? }
      const text = result.content?.map((c) => c.text).join("\n") ?? "";
      // Try to parse text as JSON for structured response
      let data: unknown = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      return sendJson(res, result.isError ? 500 : 200, {
        ok: !result.isError,
        result: data,
        text,
      });
    } catch (e) {
      return sendJson(res, 500, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  process.stderr.write(
    `[email-mcp-http] v${VERSION} listening on http://${HOST}:${PORT} (${tools.size} tools)\n`,
  );
});

const shutdown = (sig: string) => {
  process.stderr.write(`[email-mcp-http] shutdown (${sig})\n`);
  server.close(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Keep the HTTP wrapper alive when the underlying IMAP client emits stray
// 'error' events (e.g. socket timeouts on idle connections). These would
// otherwise crash the process via unhandled 'error' events.
process.on("uncaughtException", (err) => {
  process.stderr.write(
    `[email-mcp-http] uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
});
process.on("unhandledRejection", (reason) => {
  process.stderr.write(
    `[email-mcp-http] unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}\n`,
  );
});
