#!/usr/bin/env node
// Run the bootstrap conformance suite: native engine vs `bootstrap/nblk1.nblk`.
//
//   node tools/bootstrap-check.mjs          # every program in bootstrap/tests
//   node tools/bootstrap-check.mjs --self   # also nblk1 interpreting itself
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "packages/cli/src/bin.ts");
const nblk1 = join(root, "bootstrap/nblk1.nblk");
const nblk2 = join(root, "bootstrap/nblk2.nblk");
const cache = join(root, ".tmp-check");

function run(command, args) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 900_000,
  });
  return { status: result.status, out: result.stdout ?? "", err: result.stderr ?? "" };
}

function native(file) {
  return run(cli, [file]);
}

function interpreted(ir) {
  return run(cli, [nblk1, ir]);
}

function viaSourceFrontEnd(file) {
  return run(cli, [nblk2, "--", file]);
}

mkdirSync(cache, { recursive: true });
const dump = (file, out) => {
  execFileSync(process.execPath, [join(root, "tools/ir-dump.mjs"), file, out], { cwd: root });
};

const tests = readdirSync(join(root, "bootstrap/tests")).filter((name) => name.endsWith(".nblk")).sort();
let failed = 0;
for (const name of tests) {
  const file = join(root, "bootstrap/tests", name);
  const ir = join(cache, name.replace(/\.nblk$/, ".ir.json"));
  dump(file, ir);
  const expected = native(file);
  const actual = interpreted(ir);
  const front = viaSourceFrontEnd(file);
  if (expected.status !== actual.status || expected.out !== actual.out) {
    failed += 1;
    console.error(`✖ ${name}: status ${expected.status} vs ${actual.status}`);
    console.error(`  native:   ${JSON.stringify(expected.out.slice(0, 200))}`);
    console.error(`  nblk1:    ${JSON.stringify(actual.out.slice(0, 200))}`);
  } else {
    console.log(`✔ ${name}`);
  }
  if (expected.status !== front.status || expected.out !== front.out) {
    failed += 1;
    console.error(`✖ ${name} (nblk2): status ${expected.status} vs ${front.status}`);
    console.error(`  native:   ${JSON.stringify(expected.out.slice(0, 200))}`);
    console.error(`  nblk2:    ${JSON.stringify(front.out.slice(0, 200))}`);
  } else {
    console.log(`✔ ${name} (nblk2)`);
  }
}

if (process.argv.includes("--self")) {
  const ir = join(root, "bootstrap/nblk1.ir.json");
  dump(nblk1, ir);
  const demoIr = join(root, "bootstrap/examples/demo.ir.json");
  if (!existsSync(demoIr)) dump(join(root, "bootstrap/examples/demo.nblk"), demoIr);
  const direct = interpreted(demoIr);
  const nested = run(cli, [nblk1, ir, demoIr]);
  if (direct.out !== nested.out || direct.status !== nested.status) {
    failed += 1;
    console.error("✖ self-hosting: nblk1(nblk1, demo) differs from nblk1(demo)");
    console.error(`  direct: ${JSON.stringify(direct.out)}`);
    console.error(`  nested: ${JSON.stringify(nested.out)}`);
  } else {
    console.log("✔ self-hosting (nblk1 interprets itself on the demo)");
  }
  const sourceNested = run(cli, [nblk2, "--", nblk1, demoIr]);
  if (direct.out !== sourceNested.out || direct.status !== sourceNested.status) {
    failed += 1;
    console.error("✖ source self-hosting: nblk2(nblk1.nblk, demo) differs");
    console.error(`  direct: ${JSON.stringify(direct.out)}`);
    console.error(`  nblk2:  ${JSON.stringify(sourceNested.out)}`);
  } else {
    console.log("✔ source self-hosting (nblk2 compiles nblk1 and runs the demo)");
  }
}

process.exit(failed === 0 ? 0 : 1);
