# email-mcp

MCP-Server für IMAP/SMTP-Zugriff auf persönliche Mail-Accounts. Multi-Account-Support via JSON-Config. 12 Tools für Lesen/Suchen/Senden/Flaggen/Attachments/Bulk-Move.

## Endpoints

| Surface | URL | Auth |
|---|---|---|
| REST | `http://<host>:32200` | LAN / CF-Access-Token `email-token` |
| MCP Streamable-HTTP | `http://<host>:33200/mcp` | LAN / CF-Access-Token `email-token` |
| MCP stdio | `node --env-file=.env dist/index.js` | — (lokaler Prozess für Claude Desktop) |

Pfad-Konvention: `/mcp` ohne trailing slash (Node-SDK).
Public hostnames (CF-Tunnel): `api-email.pommerconsulting.de` / `mcp-email.pommerconsulting.de`.

## Tools

| Name | Zweck |
|---|---|
| `list_emails` | Mails in Folder auflisten (sender/subject/date/uid + hasAttachments) |
| `read_email` | Vollen Inhalt einer Mail via UID lesen (Text+HTML+Attachment-Metadaten) |
| `search_emails` | Volltext-Suche (subject/from/body/all) |
| `list_folders` | IMAP-Folder listen |
| `mark_email` | read/unread/flag/unflag setzen |
| `delete_email` | Mail in Trash verschieben (oder permanent falls schon in Trash) |
| `move_email` | Einzelne Mail zwischen Foldern verschieben (auto-create destination) |
| `move_emails_bulk` | Mehrere UIDs im selben IMAP-Call verschieben (performant) |
| `send_email` | Neue Mail via SMTP senden |
| `reply_email` | Mail beantworten (threading via `in_reply_to`) |
| `save_draft` | Mail-Entwurf im Drafts-Folder ablegen (sendet nicht) |
| `get_attachment` | Anhang herunterladen; text-extract für PDF/DOCX/XLSX/PPTX/TXT/HTML, VLM-OCR für Bilder, sonst base64 |

Jedes Tool nimmt `account` (optional, default aus Config) — Beschreibung listet verfügbare Accounts.

## Config

`$EMAIL_ACCOUNTS_FILE` (default `~/.email-mcp/accounts.json`):

```json
{
  "accounts": {
    "main": {
      "imap": { "host": "imap.gmx.net", "port": 993, "secure": true },
      "smtp": { "host": "mail.gmx.net", "port": 587, "secure": false },
      "user": "...@gmx.de",
      "password": "app-password",
      "fromName": "Klaus Pommer"
    }
  },
  "defaultAccount": "main"
}
```

## Env

| Variable | Default | Pflicht |
|---|---|---|
| `EMAIL_ACCOUNTS_FILE` | `~/.email-mcp/accounts.json` | |
| `LISTEN_PORT` | 32200 | |
| `MCP_PORT` | 33200 | |
| `LISTEN_HOST` | 0.0.0.0 | |
| `VLM_URL` | `http://localhost:8089` | (für `get_attachment` image-OCR) |
| `VLM_MODEL` | `qwen3-vl-8b` | |
| `LOG_LEVEL` | info | |

## Beispiel-Calls (REST)

```bash
# letzte 5 ungelesenen Mails
curl -fsS -X POST http://localhost:32200/tools/list_emails \
  -H 'content-type: application/json' \
  -d '{"folder":"INBOX","limit":5,"unread_only":true}'

# Rechnung als Text extrahieren
curl -fsS -X POST http://localhost:32200/tools/get_attachment \
  -H 'content-type: application/json' \
  -d '{"uid":1234,"filename":"invoice.pdf","extract_text":true}'
```
