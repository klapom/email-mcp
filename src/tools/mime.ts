/**
 * Shared MIME helpers built on imapflow's parsed BODYSTRUCTURE tree.
 *
 * imapflow already parses the (possibly deeply nested) MIME tree server-side and
 * assigns each leaf a `part` identifier usable with `fetch({ bodyParts })` or
 * `download()`. We walk that tree instead of re-splitting the raw RFC822 source,
 * which makes nested Outlook multiparts and inline attachments visible for free
 * and lets us fetch only the body parts we need (no attachment bytes).
 */

// biome-ignore lint/suspicious/noExplicitAny: imapflow bodyStructure is loosely typed
type BodyStructure = any;

export interface MimePart {
  /** BODYPART identifier, e.g. "1", "1.2", "2.1.3". Use with fetch({ bodyParts }). */
  part: string;
  /** Lowercased content type without parameters, e.g. "application/pdf". */
  mimeType: string;
  /** filename (Content-Disposition) or name (Content-Type), if any. */
  filename?: string;
  /** Expected size in bytes (from BODYSTRUCTURE), 0 if unknown. */
  size: number;
  /** Lowercased Content-Transfer-Encoding, e.g. "base64". */
  encoding: string;
  /** Lowercased Content-Disposition value, "" if absent. */
  disposition: string;
  /** True if this leaf should be surfaced as an attachment (incl. inline). */
  isAttachment: boolean;
  /** True if this is a body text part (text/plain or text/html, not an attachment). */
  isText: boolean;
}

function leafFilename(node: BodyStructure): string | undefined {
  return node?.dispositionParameters?.filename ?? node?.parameters?.name ?? undefined;
}

/**
 * Walk the BODYSTRUCTURE tree and return its leaf parts (recursively, through any
 * number of nested multipart containers).
 */
export function flattenParts(bodyStructure: BodyStructure): MimePart[] {
  const out: MimePart[] = [];

  const walk = (node: BodyStructure): void => {
    if (!node) return;

    if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
      for (const child of node.childNodes) walk(child);
      return;
    }

    const mimeType = (node.type ?? "").toLowerCase();
    const filename = leafFilename(node);
    const disposition = (node.disposition ?? "").toLowerCase();

    // #4: an attachment is anything explicitly dispositioned "attachment", OR
    // anything carrying a filename that isn't a text/* body or a multipart
    // container — this catches inline images (Content-Disposition: inline)
    // that mail clients still show as attachments.
    const isAttachment =
      disposition === "attachment" ||
      (!!filename && !mimeType.startsWith("text/") && !mimeType.startsWith("multipart/"));

    const isText = !isAttachment && (mimeType === "text/plain" || mimeType === "text/html");

    out.push({
      // A non-multipart message has a single root leaf with no `part`; IMAP
      // addresses its body as part "1".
      part: node.part ?? "1",
      mimeType,
      filename,
      size: typeof node.size === "number" ? node.size : 0,
      encoding: (node.encoding ?? "").toLowerCase(),
      disposition,
      isAttachment,
      isText,
    });
  };

  walk(bodyStructure);
  return out;
}

/** Public attachment metadata shape returned by list_emails / read_email. */
export interface AttachmentMeta {
  filename: string;
  size: number;
  type: string;
}

export function attachmentList(parts: MimePart[]): AttachmentMeta[] {
  return parts
    .filter((p) => p.isAttachment)
    .map((p) => ({ filename: p.filename ?? "unknown", size: p.size, type: p.mimeType }));
}

/** Decode a transfer-encoded body part to text (utf-8). */
export function decodeBody(body: string, encoding: string): string {
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
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return body;
}

/** Decode a transfer-encoded body part to raw bytes. */
export function decodeBytes(body: string, encoding: string): Buffer {
  const enc = encoding.toLowerCase().trim();
  if (enc === "base64") {
    return Buffer.from(body.replace(/\s+/g, ""), "base64");
  }
  if (enc === "quoted-printable") {
    const decoded = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    return Buffer.from(decoded, "binary");
  }
  return Buffer.from(body, "binary");
}
