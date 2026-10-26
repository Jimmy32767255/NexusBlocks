#!/usr/bin/env node
// Compile a .nblk file into project IR JSON (the input format for bootstrap/nblk1.nblk).
// Imports are resolved by default so the dump is self-contained; pass --no-imports
// to dump a single file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseNblk } from "../packages/ir/src/nblk.ts";
import { resolveImports } from "../packages/engine/src/modules.ts";
import { createNodeHost } from "../packages/cli/src/host.ts";

const raw = process.argv.slice(2);
const noImports = raw.includes("--no-imports");
const [file, out] = raw.filter((arg) => arg !== "--no-imports");
if (!file) {
  console.error("usage: node tools/ir-dump.mjs <program.nblk> [out.json] [--no-imports]");
  process.exit(2);
}
const parsed = parseNblk(readFileSync(file, "utf8"));
if (!parsed.ok) {
  console.error(`${file}:${parsed.error.line}: ${parsed.error.message}`);
  process.exit(1);
}
let project = parsed.document.project;
if (!noImports) {
  const host = createNodeHost({ baseDir: dirname(resolve(file)), write: () => {} });
  const resolved = await resolveImports(project, { host });
  if (resolved.errors.length > 0) {
    for (const error of resolved.errors) console.error(`${error.messageKey} ${JSON.stringify(error.params)}`);
    process.exit(1);
  }
  project = resolved.project;
}
const json = JSON.stringify(project, null, 1);
if (out) writeFileSync(out, json);
else process.stdout.write(json + "\n");
