import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ToolDef } from "@klapom/mcp-toolkit-ts";
import { z } from "zod";
import { accountParam, getAccount } from "../config.js";
import { withImap } from "../upstream/imap-client.js";
import type { ToolsContext } from "./context.js";
import { decodeBytes, flattenParts } from "./mime.js";

const VLM_URL = process.env.VLM_URL ?? "http://localhost:8089";
const VLM_MODEL = process.env.VLM_MODEL ?? "qwen3-vl-8b";
const VLM_TIMEOUT_MS = 90_000;

const execFileAsync = promisify(execFile);

async function analyzeImageWithVLM(
  bytes: Buffer,
  mimeType: string,
  prompt?: string,
): Promise<string> {
  const base64 = bytes.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const question =
    prompt ??
    "Lies alle Texte, Zahlen und wichtigen Inhalte aus diesem Bild/Scan vor. Falls es ein Dokument oder eine Rechnung ist, gib alle Felder mit ihren Werten aus.";

  const body = JSON.stringify({
    model: VLM_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: question },
        ],
      },
    ],
    max_tokens: 2048,
    temperature: 0.1,
  });

  return new Promise((resolve) => {
    const url = new URL("/v1/chat/completions", VLM_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = httpRequest(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = parsed?.choices?.[0]?.message?.content ?? "(VLM returned no content)";
          resolve(text);
        } catch {
          resolve(`(VLM response parse error: ${data.slice(0, 200)})`);
        }
      });
    });

    req.setTimeout(VLM_TIMEOUT_MS, () => {
      req.destroy();
      resolve("(VLM timeout — image analysis took too long)");
    });
    req.on("error", (err: Error) => resolve(`(VLM connection error: ${err.message})`));
    req.write(body);
    req.end();
  });
}

async function extractText(
  bytes: Buffer,
  filename: string,
  mimeType: string,
  prompt?: string,
): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (mimeType.includes("text/plain") || ext === "txt" || ext === "csv" || ext === "md") {
    return bytes.toString("utf-8");
  }

  if (mimeType.includes("text/html") || ext === "html" || ext === "htm") {
    return bytes
      .toString("utf-8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const imageExts = ["jpg", "jpeg", "png", "tiff", "tif", "webp", "bmp", "gif"];
  if (mimeType.startsWith("image/") || imageExts.includes(ext)) {
    return analyzeImageWithVLM(bytes, mimeType || `image/${ext}`, prompt);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "email-mcp-"));
  try {
    const inFile = join(tmpDir, filename);
    writeFileSync(inFile, bytes);

    if (mimeType.includes("pdf") || ext === "pdf") {
      try {
        const { stdout } = await execFileAsync("pdftotext", ["-layout", inFile, "-"]);
        return stdout.trim() || "(PDF extracted but no text found)";
      } catch {
        return "(PDF text extraction failed — pdftotext not available. Use extract_text=false to get base64.)";
      }
    }

    const libreofficeFormats = [
      "docx",
      "doc",
      "xlsx",
      "xls",
      "pptx",
      "ppt",
      "odt",
      "ods",
      "odp",
      "rtf",
    ];
    if (libreofficeFormats.includes(ext)) {
      try {
        await execFileAsync("libreoffice", [
          "--headless",
          "--convert-to",
          "txt:Text",
          "--outdir",
          tmpDir,
          inFile,
        ]);
        const outFile = join(tmpDir, filename.replace(/\.[^.]+$/, ".txt"));
        const { readFileSync } = await import("node:fs");
        return readFileSync(outFile, "utf-8").trim() || "(Document extracted but no text found)";
      } catch {
        return "(Document text extraction failed — LibreOffice not available. Use extract_text=false to get base64.)";
      }
    }

    return `(Binary format ${ext} not supported for text extraction. Use extract_text=false to get base64 content.)`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function buildMailAttachmentTools(
  ctx: ToolsContext,
): // biome-ignore lint/suspicious/noExplicitAny: heterogeneous Zod shapes per tool
Array<ToolDef<any, ToolsContext>> {
  const { description, defaultName } = accountParam(ctx.config);

  const get_attachment: ToolDef<z.ZodRawShape, ToolsContext> = {
    name: "get_attachment",
    description:
      "Download an email attachment and return its content. Use extract_text=true to get the text content of PDF, DOCX, XLSX, PPTX and other document formats directly.",
    shape: {
      account: z.string().default(defaultName).describe(description),
      uid: z.number().int().describe("Email UID from list_emails or read_email"),
      folder: z.string().default("INBOX").describe("IMAP folder path"),
      filename: z
        .string()
        .describe("Attachment filename to download (from read_email attachments list)"),
      extract_text: z
        .boolean()
        .default(true)
        .describe(
          "Extract text content from document (PDF, DOCX, XLSX, PPTX, TXT, HTML) or image/scan (JPEG, PNG, TIFF via VLM-OCR). If false, returns raw base64.",
        ),
      prompt: z
        .string()
        .optional()
        .describe(
          "Optional: custom question for images/scans (e.g. 'Was kostet die Rechnung?'). Only used for image attachments. Default: extract all text.",
        ),
    },
    handler: async (ctx, args) => {
      const {
        account: accountName,
        uid,
        folder,
        filename,
        extract_text,
        prompt,
      } = args as {
        account: string;
        uid: number;
        folder: string;
        filename: string;
        extract_text: boolean;
        prompt?: string;
      };
      const account = getAccount(ctx.config, accountName);

      const result = await withImap(account, async (client) => {
        await client.mailboxOpen(folder, { readOnly: true });

        // Locate the attachment via the parsed BODYSTRUCTURE tree (recursive,
        // inline-aware), then download only that one part — never the whole
        // RFC822 source. Works for nested Outlook multiparts and inline images
        // that the old top-level source split missed.
        let parts: ReturnType<typeof flattenParts> = [];
        let found = false;
        for await (const msg of client.fetch([uid], { bodyStructure: true }, { uid: true })) {
          found = true;
          parts = flattenParts(msg.bodyStructure);
        }
        if (!found) {
          return { error: `Email UID ${uid} not found.` };
        }

        const target = parts.find(
          (p) => p.isAttachment && (p.filename ?? "").toLowerCase() === filename.toLowerCase(),
        );
        if (!target) {
          return { error: `Attachment "${filename}" not found in email UID ${uid}.` };
        }

        let bytes: Buffer | null = null;
        for await (const msg of client.fetch([uid], { bodyParts: [target.part] }, { uid: true })) {
          const raw = msg.bodyParts?.get(target.part);
          if (raw) bytes = decodeBytes(raw.toString("binary"), target.encoding);
        }
        if (!bytes) {
          return { error: `Attachment "${filename}" could not be downloaded from UID ${uid}.` };
        }

        const partFilename = target.filename ?? filename;
        const mimeType = target.mimeType;

        if (!extract_text) {
          return {
            filename: partFilename,
            mimeType,
            size: bytes.length,
            content: bytes.toString("base64"),
            encoding: "base64",
          };
        }

        const text = await extractText(bytes, partFilename, mimeType, prompt);
        return {
          filename: partFilename,
          mimeType,
          size: bytes.length,
          text,
        };
      });

      if ("error" in result) {
        return {
          content: [{ type: "text", text: result.error ?? "Unknown error" }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  };

  return [get_attachment];
}
