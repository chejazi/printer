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
| `PRINTER_NAME` | No | Built-in fallback | Default CUPS printer queue |
| `SEQUENCE_STATE_FILE` | No | `.runtime/sequence-cursors.json` | Sequence cursor JSON path |
| `COALESCE_MS` | No | `500` | Wait after the last message before printing a batch |
| `JOB_DELAY_MS` | No | `500` | Pause between completed CUPS batches |
| `JOB_TIMEOUT_MS` | No | `30000` | Cancel a CUPS job if it has not finished in time |
| `MAX_QUEUE_MESSAGES` | No | `100` | Reject new messages when the queue is full |

Find your printer queue name:

```bash
npm run list
```

Keep `.env`, `.runtime/`, logs, and generated local exports out of Git. Use `.env.example` for placeholders only.

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
| `POST` | `/print-sequence` | Bearer | Resolve and print one dynamic sequence frame |

### Print examples

JSON body:

```bash
curl -X POST http://<host>:3000/print \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Order #42\n2x Coffee"}'
```

Plain text body:

```bash
curl -X POST http://<host>:3000/print \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "Content-Type: text/plain" \
  -d "Hello, receipt!"
```

Optional JSON fields:

- `noCut` — skip the paper cut at the end (default: `false`)
- `feedLines` — blank lines to feed after text (0–50). Defaults to `10` when `noCut` is true, `0` when cutting. Applied once at the end of a batch, not between messages
- `printer` — override the CUPS queue for this job
- `flush` — print the current batch immediately instead of waiting for the coalesce window

`POST /print` returns immediately. Messages are batched in memory and printed as one CUPS job (joined with single newlines, no extra feeds between messages). Rapid requests within `COALESCE_MS` of each other print together on one receipt.

Success response:

```json
{
  "ok": true,
  "queued": true,
  "printer": "<cups-printer-queue>",
  "pendingMessages": 3,
  "pendingBatches": 1
}
```

## CLI

Print from the command line without running the server:

```bash
npm run print -- "Hello, receipt!"
npm run print -- --printer <cups-printer-queue> "Order #42"
npm run print -- --no-cut "Visible on stream"
npm run print -- --no-cut --feed-lines 10 "Extra margin"
npm run list
```

Environment variables (`PRINTER_NAME`) and flags (`--printer`) work the same as the HTTP API.

## Receipt Simulator

The repository includes a standalone browser workspace for designing 80mm plain-text receipts. It runs without CUPS, a configured printer, or `AUTH_TOKEN`, and it never performs printer detection or touches the print queue.

```bash
npm run preview
```

Open `http://127.0.0.1:4173`. The preview server binds to localhost by default; set `PREVIEW_PORT` or `PREVIEW_HOST` if needed. It serves only the simulator and the shared, printer-independent receipt-format module. For a safe remote preview, bind deliberately and keep placeholders in docs or scripts:

```bash
PREVIEW_HOST=0.0.0.0 PREVIEW_PORT=4173 npm run preview
```

Then browse to `http://<lan-host>:4173`. Do not commit tunnel URLs, live hostnames, or tokens.

To enable the guarded **PRINT CURRENT FRAME** action in the `SEQUENCE` workspace, run the production printer API with its bearer token, then start the preview server with a narrow same-origin proxy. The token stays in the preview-server process and is never embedded in browser JavaScript or written to `localStorage`:

```bash
AUTH_TOKEN=<AUTH_TOKEN> PRINTER_NAME=<cups-printer-queue> npm start

PREVIEW_PRINT_API_URL=http://127.0.0.1:3000 \
PREVIEW_PRINT_AUTH_TOKEN=<AUTH_TOKEN> \
PREVIEW_PRINT_PRINTER_NAME=<cups-printer-queue> \
PREVIEW_PRINT_TIMEOUT_MS=45000 \
PREVIEW_PRINT_POLL_MS=500 \
npm run preview
```

For a remote printer API exposed through a tunnel, set `PREVIEW_PRINT_API_URL=<fixed-printer-api-origin>` on the preview server. Do not put tunnel URLs or bearer tokens in browser source, committed files, custom block JSON, sequence exports, or localStorage. The browser cannot choose an arbitrary print destination; it can only call the same-origin preview proxy configured by these environment variables.

The editor and procedural tools produce plain text using the printer's 48-character line width. Overflow is reported without wrapping or silently rewriting the design. Copy, `.txt` download, browser print/PDF, and the receipt preview all use the same exact editor value. That value can be sent directly as the existing JSON `text` field:

```json
{ "text": "YOUR RECEIPT TEXT" }
```

Generators are deterministic: the same seed, dimensions, complexity, character mode, and style produce the same text. ASCII mode is the printer-safe default; extended Unicode support depends on the printer's configured code page.

The **Block Library** stores exact reusable text separately from generators. Built-in headers, dividers, frames, labels, footers, fixed procedural examples, and complete receipts are read-only; duplicate one to make an editable custom version. Custom blocks are stored only in browser `localStorage` and can be exported or imported as JSON. Imports are validated before they replace the local custom library, and blocks wider than 48 columns remain unchanged but display a warning.

### ASCII sequences

Open the `SEQUENCE` workspace to work with frame-based receipts. Choose the built-in **higher.zip Running Horse** sequence from the sequence selector, or load a local JSON export with the import control. The built-in horse is the complete 162-frame brand sequence as receipt-native 48×14 plain text. The browser workspace previews it at its source extraction cadence of 8 fps, composes a stable prefix and suffix around the current frame, and can export/reimport complete sequence JSON. Preview playback never sends print jobs.

Local image sequences can be selected as a directory or group of files. Conversion happens entirely in the browser: source images are not uploaded, written to the server, or stored in `localStorage`. Controls cover natural ordering, crop, width, character aspect, sequence/per-frame normalization, palette, inversion, brightness, contrast, threshold, padding, alignment, and FPS metadata. Only the small cursor index for browser preview is persisted locally.

The authenticated `POST /print-sequence` endpoint is additive and leaves `/print` unchanged. It accepts JSON with a `template`, optional `sequence`, optional `advanceOnSuccess`, and the same `printer`, `noCut`, `feedLines`, and `flush` fields as `/print`. The dynamic template syntax is `{{sequence:<sequence-id>}}`; for the built-in horse, include `{{sequence:higher-zip-running-horse}}`:

```json
{
  "template": "higher.zip\n{{sequence:higher-zip-running-horse}}\nTHANK YOU",
  "sequence": "higher-zip-running-horse",
  "advanceOnSuccess": true,
  "printer": "<cups-printer-queue>"
}
```

The template resolves when its coalesced physical batch begins. Its server cursor advances once only after the existing CUPS job and queue-wait operations succeed, never when queued or on failure. Multiple dynamic messages coalesced into one physical receipt advance the sequence once. Cursor state is atomically stored in ignored `.runtime/sequence-cursors.json`; set `SEQUENCE_STATE_FILE` to override that path. Browser preview FPS controls animation speed on screen only; the physical printer cadence is controlled by print requests, CUPS completion, `COALESCE_MS`, and `JOB_DELAY_MS`.

For a controlled physical-printer test, first run `npm test`, confirm the intended queue with `npm run list`, then start the API with placeholder-backed local configuration:

```bash
AUTH_TOKEN=<AUTH_TOKEN> PRINTER_NAME=<cups-printer-queue> npm start
```

Send one explicit flushed sequence request from another shell:

```bash
curl -X POST http://127.0.0.1:3000/print-sequence \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"template":"higher.zip\n{{sequence:higher-zip-running-horse}}\nTEST","sequence":"higher-zip-running-horse","flush":true,"printer":"<cups-printer-queue>"}'
```

Inspect the single printed receipt and `.runtime/sequence-cursors.json`, then stop the server. Do not run this procedure from automated tests.

To add a generator, create a dependency-free module in `preview/generators/` that exports `{ id, label, generate(options) }`. `generate` must return plain text, honor `options.width` up to 48 columns, and use the seeded helper in `preview/generators/random.js`. Register it in `preview/generators/index.js` and include its browser script in `preview/index.html`.

### Whitespace compatibility

Receipt layouts rely on whitespace. The print path preserves leading spaces and intentional blank lines, including blank lines inside queued messages. It removes trailing spaces at the ESC/POS line-writing boundary because those spaces carry no visible ink. Multiple queued API messages are still separated by one newline as before. Earlier versions trimmed the entire `/print` value and removed every empty line; this repository now preserves that formatting so simulator text reaches paper accurately. The `/print` request shape, authentication, batching, CUPS invocation, and CLI remain unchanged.

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
lib/printer.js      Shared ESC/POS + CUPS printing logic
lib/print-queue.js  Debounced batch queue and serial CUPS worker
server.js           Express HTTP API
print.js            CLI entry point
```

## License

ISC
