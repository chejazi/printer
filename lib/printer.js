const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { ThermalPrinter, PrinterTypes } = require("node-thermal-printer");

const execFileAsync = promisify(execFile);

const DEFAULT_PRINTER = "USB_80Series2";
const CHARS_PER_LINE = 48;

function buildEscPosBuffer(text, { noCut = false } = {}) {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: CHARS_PER_LINE,
    interface: process.platform === "win32" ? "NUL" : "/dev/null",
  });

  printer.alignLeft();
  printer.println(text);
  printer.newLine();

  if (!noCut) {
    printer.cut();
  }

  return printer.getBuffer();
}

function sendRawJob(printerName, data) {
  return new Promise((resolve, reject) => {
    const lp = spawn("lp", ["-d", printerName, "-o", "raw"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";

    lp.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    lp.on("error", reject);

    lp.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(stderr.trim() || `lp exited with status ${code}`),
      );
    });

    lp.stdin.write(data);
    lp.stdin.end();
  });
}

async function listPrinters() {
  const { stdout } = await execFileAsync("lpstat", ["-p"]);
  return stdout
    .split("\n")
    .map((line) => line.match(/^printer\s+(\S+)/)?.[1])
    .filter(Boolean);
}

async function printText(text, { printer, noCut = false } = {}) {
  const printerName = printer || process.env.PRINTER_NAME || DEFAULT_PRINTER;
  const buffer = buildEscPosBuffer(text, { noCut });
  await sendRawJob(printerName, buffer);
  return { printer: printerName, text };
}

module.exports = {
  DEFAULT_PRINTER,
  buildEscPosBuffer,
  sendRawJob,
  listPrinters,
  printText,
};
