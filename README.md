# Thermal Print Server

Small Node.js service for printing plain text to an 80mm ESC/POS thermal printer (tested with Rongta hardware) over CUPS. Includes a CLI for local testing and an HTTP API for remote print jobs — handy on a Raspberry Pi on your LAN.

## Requirements

- Node.js 18+
- CUPS with a configured printer queue (`lp`, `lpstat`)
- Linux or macOS (uses CUPS `lp -o raw`)

## Setup

```bash
git clone <repo-url>
cd printer
npm install
cp .env.example .env
# Edit .env and set AUTH_TOKEN to a long random string
```

## Configuration

Copy `.env.example` to `.env` and adjust values:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_TOKEN` | Yes | — | Bearer token for protected API routes |
| `PORT` | No | `3000` | HTTP listen port |
| `PRINTER_NAME` | No | `USB_80Series2` | Default CUPS printer queue |

Find your printer queue name:

```bash
npm run list
```

## HTTP server

Start the server:

```bash
npm start
```

The server listens on `0.0.0.0` so other devices on your network can reach it.

### Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Liveness check |
| `GET` | `/printers` | Bearer | List CUPS printer queues |
| `POST` | `/print` | Bearer | Print text |

### Print examples

JSON body:

```bash
curl -X POST http://<host>:3000/print \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Order #42\n2x Coffee"}'
```

Plain text body:

```bash
curl -X POST http://<host>:3000/print \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: text/plain" \
  -d "Hello, receipt!"
```

Optional JSON fields:

- `noCut` — skip the paper cut at the end (default: `false`)
- `feedLines` — blank lines to feed after text (0–50). Defaults to `10` when `noCut` is true, `0` when cutting
- `printer` — override the CUPS queue for this job

Success response:

```json
{
  "ok": true,
  "printer": "USB_80Series2",
  "text": "Order #42\n2x Coffee",
  "noCut": true,
  "feedLines": 10
}
```

## CLI

Print from the command line without running the server:

```bash
npm run print -- "Hello, receipt!"
npm run print -- --printer USB_80Series2 "Order #42"
npm run print -- --no-cut "Visible on stream"
npm run print -- --no-cut --feed-lines 10 "Extra margin"
npm run list
```

Environment variables (`PRINTER_NAME`) and flags (`--printer`) work the same as the HTTP API.

## Raspberry Pi

1. Install Node.js and set up your printer in CUPS.
2. Clone the repo, run `npm install`, and create `.env`.
3. Confirm printing works locally: `npm run print -- "test"`.
4. Start the server: `npm start`.

To run on boot with systemd, create `/etc/systemd/system/thermal-print.service`:

```ini
[Unit]
Description=Thermal print server
After=network.target cups.service

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/printer
EnvironmentFile=/home/pi/printer/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thermal-print
```

## Project layout

```
lib/printer.js   Shared ESC/POS + CUPS printing logic
server.js        Express HTTP API
print.js         CLI entry point
```

## License

ISC
