#!/usr/bin/env node
const path = require("node:path");
const express = require("express");

const HOST = process.env.PREVIEW_HOST || "127.0.0.1";
const PORT = Number(process.env.PREVIEW_PORT) || 4173;
const app = express();

app.use("/lib", express.static(path.join(__dirname, "lib"), { index: false }));
app.use(express.static(path.join(__dirname, "preview")));

app.listen(PORT, HOST, () => {
  console.log(`Receipt simulator listening on http://${HOST}:${PORT}`);
});
