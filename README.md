# email-mcp

IMAP/SMTP MCP Server for Claude Desktop and Claude Code. Read, search, and send emails via natural language.

## Features
- Read and list emails (IMAP)
- Search emails by subject, sender, date
- Send emails (SMTP)
- Manage folders and flags

## Configuration
Copy `.env.example` to `.env` and fill in your credentials:
- `IMAP_HOST` / `SMTP_HOST` — your mail server
- `EMAIL_USER` — your email address
- `EMAIL_PASSWORD` — your password or app password

## Usage with mcporter
Add to `~/.mcporter/mcporter.json`:
```json
"email": {
  "command": "node /path/to/email-mcp/dist/index.js"
}
```
