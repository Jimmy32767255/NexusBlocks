import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const source = path.resolve(import.meta.dirname, "..", "dist", "nblk");
const binDir = process.env.XDG_BIN_HOME ?? path.join(homedir(), ".local", "bin");
mkdirSync(binDir, { recursive: true });
const target = path.join(binDir, "nblk");
copyFileSync(source, target);
chmodSync(target, 0o755);
console.log(`Installed ${target}`);
console.log("Make sure that directory is on PATH, then run: nblk <file.nblk>");
