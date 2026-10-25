#!/usr/bin/env node
// Compile a .nblk file into project IR JSON (the input format for bootstrap/nblk1.nblk).
import { readFileSync, writeFileSync } from "node:fs";
import { parseNblk } from "../packages/ir/src/nblk.ts";

const [file, out] = process.argv.slice(2);
if (!file) {
  console.error("usage: node tools/ir-dump.mjs <program.nblk> [out.json]");
  process.exit(2);
}
const parsed = parseNblk(readFileSync(file, "utf8"));
if (!parsed.ok) {
  console.error(`${file}:${parsed.error.line}: ${parsed.error.message}`);
  process.exit(1);
}
const json = JSON.stringify(parsed.document.project, null, 1);
if (out) writeFileSync(out, json);
else process.stdout.write(json + "\n");
