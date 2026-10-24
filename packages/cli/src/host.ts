import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  CapabilityUnavailableError,
  CONSOLE_PRINT,
  FS_CAPABILITIES,
  HostError,
  MAX_FILE_CHARS,
  OS_CAPABILITIES,
  OS_EXEC_CAPABILITY,
} from "@nexus/engine";
import type { HostBridge, HostRequest } from "@nexus/engine";
import type { Value } from "@nexus/ir";

const MAX_COMMAND_OUTPUT = 200_000;

export interface NodeHostOptions {
  /** Base directory for relative paths and imports. */
  baseDir: string;
  /** Line sink for `console.print`; defaults to stdout in `main.ts`. */
  write: (text: string) => void;
  /** Locale used for host errors is not needed: errors carry translation keys. */
}

function display(value: Value): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(display).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Resolve a script path against the entry file's directory. */
export function resolveScriptPath(raw: Value | undefined, baseDir: string): string {
  const text = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
  if (text === "") throw new HostError("runtime.error.filePath", { path: text });
  let expanded = text;
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/")) expanded = path.join(homedir(), expanded.slice(2));
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
  if (absolute.includes("\u0000")) throw new HostError("runtime.error.filePath", { path: text });
  return absolute;
}

function mapIoError(error: unknown, displayPath: string): HostError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOENT") return new HostError("runtime.error.fileNotFound", { path: displayPath });
  if (code === "EACCES" || code === "EPERM" || code === "EISDIR") {
    return new HostError("runtime.error.fileAccess", { path: displayPath });
  }
  return new HostError("runtime.error.fileStorage", {});
}

async function runShell(command: string, baseDir: string): Promise<Value> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: baseDir,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_COMMAND_OUTPUT) stdout = stdout.slice(0, MAX_COMMAND_OUTPUT);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_COMMAND_OUTPUT) stderr = stderr.slice(0, MAX_COMMAND_OUTPUT);
    });
    child.on("error", (error) => reject(new HostError("runtime.error.commandFailed", { code: 127, message: error.message })));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

/**
 * Host bridge backed by the real file system and the OS shell. Relative paths
 * resolve against the entry script's directory, which also makes imports
 * relative to the script rather than to the shell's working directory.
 */
export function createNodeHost(options: NodeHostOptions): HostBridge {
  const baseDir = options.baseDir;
  return {
    name: "node",
    capabilities() {
      return [CONSOLE_PRINT, ...FS_CAPABILITIES, ...OS_CAPABILITIES];
    },
    async invoke(request: HostRequest): Promise<Value> {
      switch (request.capability) {
        case "console.print": {
          const text = request.args.map(display).join(" ");
          options.write(text);
          return null;
        }
        case "fs.read": {
          const displayPath = String(request.args[0] ?? "");
          const file = resolveScriptPath(request.args[0], baseDir);
          try {
            return await fs.readFile(file, "utf8");
          } catch (error) {
            throw mapIoError(error, displayPath);
          }
        }
        case "fs.write": {
          const displayPath = String(request.args[0] ?? "");
          const file = resolveScriptPath(request.args[0], baseDir);
          const content = display(request.args[1] ?? "");
          if (content.length > MAX_FILE_CHARS) {
            throw new HostError("runtime.error.fileTooLarge", { limit: MAX_FILE_CHARS });
          }
          try {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, content, "utf8");
          } catch (error) {
            throw mapIoError(error, displayPath);
          }
          return null;
        }
        case "fs.exists": {
          const file = resolveScriptPath(request.args[0], baseDir);
          try {
            await fs.access(file);
            return true;
          } catch {
            return false;
          }
        }
        case "fs.delete": {
          const displayPath = String(request.args[0] ?? "");
          const file = resolveScriptPath(request.args[0], baseDir);
          try {
            await fs.unlink(file);
          } catch (error) {
            throw mapIoError(error, displayPath);
          }
          return null;
        }
        case "fs.list": {
          const dir = resolveScriptPath(request.args[0] ?? ".", baseDir);
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            return entries.map((entry) => entry.name).sort();
          } catch (error) {
            throw mapIoError(error, String(request.args[0] ?? "."));
          }
        }
        case OS_EXEC_CAPABILITY: {
          const command = typeof request.args[0] === "string" ? request.args[0] : String(request.args[0] ?? "");
          if (command.trim() === "") throw new HostError("runtime.error.emptyCommand", {});
          return await runShell(command, baseDir);
        }
        default:
          throw new CapabilityUnavailableError(request.capability);
      }
    },
  };
}
