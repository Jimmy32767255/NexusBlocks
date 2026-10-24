#!/usr/bin/env node
/**
 * Build installable packages for Nexus Blocks.
 *
 * Usage:
 *   node scripts/package.mjs linux    # Linux .deb
 *   node scripts/package.mjs windows  # Windows NSIS setup.exe
 *   node scripts/package.mjs all      # both (Windows host uses WSL for Linux)
 *
 * On Linux the Windows installer is cross-compiled with cargo-xwin + NSIS
 * (Tauri's supported cross path). On Windows the Linux package is built
 * inside WSL2, because Linux bundlers cannot run natively on Windows.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = process.platform;
const outDir = join(root, "dist", "packages");
const args = process.argv.slice(2);
const mode = args[0] ?? "all";

if (!["linux", "windows", "all"].includes(mode)) {
  console.error(`Unknown target: ${mode}\nUsage: node scripts/package.mjs [linux|windows|all]`);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  console.log(`\n$ ${[command, ...commandArgs].join(" ")}`);
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", ...options });
  if (result.error) {
    console.error(`\nFailed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nCommand failed with exit code ${result.status ?? "unknown"}.`);
    process.exit(result.status ?? 1);
  }
}

function has(command) {
  const result = spawnSync(host === "win32" ? "where" : "which", [command], { stdio: "ignore" });
  return result.status === 0;
}

function tauri(cwd, extra) {
  run("pnpm", ["exec", "tauri", "build", ...extra], { cwd });
}

function ensureRustTarget(target) {
  const result = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  if ((result.stdout ?? "").includes(target)) return;
  console.log(`Installing Rust target ${target} …`);
  run("rustup", ["target", "add", target]);
}

function targetDir(extra = "") {
  const base = process.env.CARGO_TARGET_DIR
    ? resolve(root, process.env.CARGO_TARGET_DIR)
    : join(root, "apps", "desktop", "src-tauri", "target");
  return extra ? join(base, extra) : base;
}

function collect(bundleRoot, patterns) {
  if (!existsSync(bundleRoot)) return;
  mkdirSync(outDir, { recursive: true });
  for (const pattern of patterns) {
    const dir = join(bundleRoot, dirname(pattern));
    if (!existsSync(dir)) continue;
    const base = pattern.split("/").pop();
    for (const file of readdirSync(dir)) {
      if (base.includes("*") ? !file.endsWith(base.replace("*", "")) : file !== base) continue;
      const source = join(dir, file);
      const destination = join(outDir, file);
      copyFileSync(source, destination);
      console.log(`Package: ${destination}`);
    }
  }
}

function buildLinux() {
  if (host === "win32") {
    console.log("Linux packages must be built inside WSL2 (or Docker).");
    const wsl = spawnSync("wsl", ["-e", "bash", "-lc", "command -v pnpm"], { cwd: root });
    if (wsl.status !== 0) {
      console.error(
        [
          "WSL2 is not available or pnpm is missing inside it.",
          "Install WSL2, then inside the distro:",
          "  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf",
          "  corepack enable && corepack prepare pnpm@12.15.0 --activate",
          "Then re-run this command.",
        ].join("\n"),
      );
      process.exit(1);
    }
    const wslPath = spawnSync("wsl", ["wslpath", "-a", root], { encoding: "utf8" }).stdout?.trim();
    if (!wslPath) {
      console.error("Unable to translate the project path for WSL.");
      process.exit(1);
    }
    run("wsl", ["-e", "bash", "-lc", `cd ${JSON.stringify(wslPath)} && node scripts/package.mjs linux`]);
    return;
  }

  const webview = has("pkg-config");
  if (!webview) console.warn("pkg-config not found; Tauri may fail to find WebKitGTK.");
  tauri(join(root, "apps", "desktop"), ["--bundles", "deb"]);
  collect(join(targetDir(), "release", "bundle"), ["deb/*.deb"]);
}

function buildWindows() {
  const desktop = join(root, "apps", "desktop");
  const target = "x86_64-pc-windows-msvc";

  if (host === "win32") {
    tauri(desktop, ["--bundles", "nsis"]);
    collect(join(targetDir(), "release", "bundle"), ["nsis/*.exe"]);
    return;
  }

  if (host !== "linux") {
    console.error("Windows cross-builds are supported from Linux and Windows only.");
    process.exit(1);
  }

  const missing = [];
  if (!has("cargo-xwin")) missing.push("cargo-xwin (cargo install --locked cargo-xwin)");
  if (!has("makensis")) missing.push("NSIS (apt install nsis, or put a portable makensis in PATH)");
  for (const tool of ["clang", "lld", "llvm-rc"]) {
    if (!has(tool)) missing.push(`${tool} (part of LLVM/clang)`);
  }
  if (missing.length > 0) {
    console.error(
      [
        "Missing tools for the Windows cross-build:",
        ...missing.map((item) => `  - ${item}`),
        "",
        "Ubuntu/Debian:",
        "  sudo apt install nsis llvm clang lld",
        "  rustup target add x86_64-pc-windows-msvc",
        "  cargo install --locked cargo-xwin",
      ].join("\n"),
    );
    process.exit(1);
  }

  ensureRustTarget(target);
  tauri(desktop, ["--runner", "cargo-xwin", "--target", target, "--bundles", "nsis"]);
  collect(join(targetDir(target), "release", "bundle"), ["nsis/*.exe"]);
}

mkdirSync(outDir, { recursive: true });
if (mode === "linux" || mode === "all") buildLinux();
if (mode === "windows" || mode === "all") buildWindows();
console.log(`\nDone. Packages are in ${outDir}`);
