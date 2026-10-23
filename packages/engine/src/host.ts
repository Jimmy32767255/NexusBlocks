import type { Value } from "@nexus/ir";
import type { CapabilityDescriptor, HostBridge, HostRequest, RuntimeEvent } from "./types.ts";

export class CapabilityUnavailableError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    super(`Capability unavailable: ${capability}`);
    this.name = "CapabilityUnavailableError";
    this.capability = capability;
  }
}

/** A user-level host failure carrying a translation key. */
export class HostError extends Error {
  readonly messageKey: string;
  readonly params: Record<string, string | number>;

  constructor(messageKey: string, params: Record<string, string | number> = {}) {
    super(messageKey);
    this.name = "HostError";
    this.messageKey = messageKey;
    this.params = params;
  }
}

export const CONSOLE_PRINT: CapabilityDescriptor = {
  id: "console.print",
  descriptionKey: "capability.console.print",
  risk: "none",
};

export const FS_CAPABILITIES: CapabilityDescriptor[] = [
  { id: "fs.read", descriptionKey: "capability.fs.read", risk: "medium" },
  { id: "fs.write", descriptionKey: "capability.fs.write", risk: "medium" },
  { id: "fs.exists", descriptionKey: "capability.fs.exists", risk: "low" },
  { id: "fs.delete", descriptionKey: "capability.fs.delete", risk: "medium" },
  { id: "fs.list", descriptionKey: "capability.fs.list", risk: "low" },
];

/** Minimal storage surface, satisfied by `localStorage` and by tests. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const FILES_KEY = "nexus-blocks:workspace-files";
export const MAX_FILE_CHARS = 1_000_000;
const MAX_PATH = 256;

/**
 * Normalise a workspace path: forward slashes, no leading slash, no `..`,
 * no control characters. Throws a translatable HostError when invalid.
 */
export function normalizePath(raw: Value | undefined): string {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const path = text.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  const invalid =
    path === "" ||
    path.length > MAX_PATH ||
    /[\u0000-\u001f]/.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
  if (invalid) throw new HostError("runtime.error.filePath", { path });
  return path;
}

function readFiles(storage: KeyValueStorage): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(FILES_KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function writeFiles(storage: KeyValueStorage, files: Record<string, string>): void {
  try {
    storage.setItem(FILES_KEY, JSON.stringify(files));
  } catch {
    throw new HostError("runtime.error.fileStorage");
  }
}

function display(value: Value): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(display).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * In-process host used by the editor and by embedding applications. It owns
 * no ambient authority: files live in the injected key-value storage (the
 * browser's localStorage here, a real directory in the future Tauri host), so
 * the language never learns where bytes actually are.
 */
export function createLocalHost(
  sink: (event: RuntimeEvent) => void,
  storage?: KeyValueStorage,
): HostBridge {
  return {
    name: "local",
    capabilities() {
      return storage ? [CONSOLE_PRINT, ...FS_CAPABILITIES] : [CONSOLE_PRINT];
    },
    async invoke(request: HostRequest): Promise<Value> {
      switch (request.capability) {
        case "console.print": {
          const text = request.args.map(display).join(" ");
          sink({ kind: "log", level: "info", text, blockId: request.blockId, time: Date.now() });
          return null;
        }
        case "fs.read":
        case "fs.write":
        case "fs.exists":
        case "fs.delete":
        case "fs.list": {
          if (!storage) throw new CapabilityUnavailableError(request.capability);
          const files = readFiles(storage);
          return invokeFileSystem(storage, files, request);
        }
        default:
          throw new CapabilityUnavailableError(request.capability);
      }
    },
  };
}

function invokeFileSystem(
  storage: KeyValueStorage,
  files: Record<string, string>,
  request: HostRequest,
): Value {
  switch (request.capability) {
    case "fs.read": {
      const path = normalizePath(request.args[0]);
      if (!(path in files)) throw new HostError("runtime.error.fileNotFound", { path });
      return files[path] ?? "";
    }
    case "fs.write": {
      const path = normalizePath(request.args[0]);
      const content = display(request.args[1] ?? "");
      if (content.length > MAX_FILE_CHARS) {
        throw new HostError("runtime.error.fileTooLarge", { limit: MAX_FILE_CHARS });
      }
      files[path] = content;
      writeFiles(storage, files);
      return null;
    }
    case "fs.exists": {
      const path = normalizePath(request.args[0]);
      return path in files;
    }
    case "fs.delete": {
      const path = normalizePath(request.args[0]);
      if (!(path in files)) throw new HostError("runtime.error.fileNotFound", { path });
      delete files[path];
      writeFiles(storage, files);
      return null;
    }
    case "fs.list":
      return Object.keys(files).sort();
    default:
      throw new CapabilityUnavailableError(request.capability);
  }
}

/** In-memory storage helper for tests and headless embedding. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}
