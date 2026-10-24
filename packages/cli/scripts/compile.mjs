import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
mkdirSync(dist, { recursive: true });

const targetArg = process.argv[2];
const target = targetArg === "windows" ? ["--target", "bun-windows-x64"] : [];
const outfile = path.join(dist, targetArg === "windows" ? "nblk.exe" : "nblk");

const result = spawnSync(
  "bun",
  ["build", "--compile", "--minify", path.join(root, "src", "bin.ts"), "--outfile", outfile, ...target],
  { stdio: "inherit" },
);
if (result.error) {
  console.error("Bun is required to build the standalone interpreter: https://bun.sh");
  process.exit(1);
}
process.exit(result.status ?? 1);
