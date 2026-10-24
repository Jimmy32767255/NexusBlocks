import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/bin.ts"],
  outfile: "dist/nblk.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: false,
  logLevel: "info",
});
