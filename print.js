#!/usr/bin/env node
const {
  printText,
  listPrinters,
  DEFAULT_PRINTER,
  DEFAULT_FEED_LINES_NO_CUT,
  MAX_FEED_LINES,
} = require("./lib/printer");

function usage() {
  console.log(`Usage: node print.js [options] [text]

Print plain text to a Rongta 80mm thermal printer via ESC/POS.

Options:
  --list              List available CUPS printers
  --printer <name>    Printer queue name (default: ${DEFAULT_PRINTER})
  --no-cut            Skip the paper cut at the end
  --feed-lines <n>    Blank lines to feed after text (0-${MAX_FEED_LINES},
                      default: ${DEFAULT_FEED_LINES_NO_CUT} with --no-cut, 0 otherwise)
  -h, --help          Show this help

Environment:
  PRINTER_NAME        Same as --printer

Examples:
  node print.js "Hello, receipt!"
  node print.js --printer USB_80Series2 "Order #42"
  node print.js --no-cut "Visible on stream"
  node print.js --no-cut --feed-lines 10 "Extra margin"
  PRINTER_NAME=USB_80Series2 node print.js "Test print"
`);
}

function parseArgs(argv) {
  const options = {
    list: false,
    help: false,
    noCut: false,
    feedLines: undefined,
    printer: process.env.PRINTER_NAME || DEFAULT_PRINTER,
    text: "",
  };

  const textParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--list") {
      options.list = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--no-cut") {
      options.noCut = true;
      continue;
    }
    if (arg === "--feed-lines") {
      const value = Number(argv[i + 1]);

      if (
        !Number.isInteger(value)
        || value < 0
        || value > MAX_FEED_LINES
      ) {
        throw new Error(
          `--feed-lines must be an integer from 0 to ${MAX_FEED_LINES}`,
        );
      }

      options.feedLines = value;
      i += 1;
      continue;
    }
    if (arg === "--printer") {
      const name = argv[i + 1];
      if (!name) {
        throw new Error("Missing value for --printer");
      }
      options.printer = name;
      i += 1;
      continue;
    }

    textParts.push(arg);
  }

  options.text = textParts.join(" ").trim();
  return options;
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exit(1);
  }

  if (options.help) {
    usage();
    return;
  }

  if (options.list) {
    const printers = await listPrinters();

    if (printers.length === 0) {
      console.log("No CUPS printers found.");
      return;
    }

    console.log("Available printers:");
    for (const name of printers) {
      console.log(`  ${name}`);
    }
    return;
  }

  if (!options.text) {
    console.error("Error: provide text to print.\n");
    usage();
    process.exit(1);
  }

  try {
    const result = await printText(options.text, {
      printer: options.printer,
      noCut: options.noCut,
      feedLines: options.feedLines,
    });
    console.log(`Printed to ${result.printer}: ${result.text}`);
  } catch (error) {
    console.error(`Print failed: ${error.message}`);
    console.error("Check the printer name with: node print.js --list");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
