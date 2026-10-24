import { promises as fs } from "node:fs";
import path from "node:path";
import { countBlocks, parseNblk } from "@nexus/ir";
import { runProject } from "@nexus/engine";
import { catalogs, createTranslator, isLocaleSupported, type Translator } from "@nexus/i18n";
import { createNodeHost } from "./host.ts";

export const VERSION = "0.1.0";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface CliOptions {
  /** Base directory for relative files; defaults to the script directory. */
  cwd?: string;
  /** Overrides process signals in tests. */
  signal?: AbortSignal;
}

interface ParsedArgs {
  file: string | null;
  check: boolean;
  json: boolean;
  locale: string | null;
  help: boolean;
  version: boolean;
  errors: string[];
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    file: null,
    check: false,
    json: false,
    locale: null,
    help: false,
    version: false,
    errors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      const rest = argv.slice(index + 1);
      if (rest.length > 0 && parsed.file === null) parsed.file = rest[0]!;
      break;
    }
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "-V" || arg === "--version") parsed.version = true;
    else if (arg === "--check") parsed.check = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--lang") {
      const value = argv[index + 1];
      if (!value) parsed.errors.push("cli.missingLang");
      else {
        parsed.locale = value;
        index += 1;
      }
    } else if (arg.startsWith("--lang=")) parsed.locale = arg.slice("--lang=".length);
    else if (arg.startsWith("-") && arg !== "-") parsed.errors.push(`cli.unknownOption\u0000${arg}`);
    else if (parsed.file === null) parsed.file = arg;
    else parsed.errors.push("cli.multipleFiles");
  }
  return parsed;
}

function localeFromEnv(): string {
  const explicit = process.env.NBLK_LANG ?? process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG;
  if (explicit) {
    const candidate = explicit.split(".")[0] ?? explicit;
    if (isLocaleSupported(candidate)) return candidate;
    const base = candidate.split(/[_-]/)[0]?.toLowerCase();
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en";
  }
  return "en";
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function translator(locale: string): Translate {
  const tr: Translator = createTranslator({ locale, catalogs });
  return (key, params) => tr.t(key, params);
}

function usage(t: Translate): string {
  return t("cli.usage", { version: VERSION });
}

function emitJson(io: CliIo, payload: Record<string, unknown>): void {
  io.out(JSON.stringify(payload));
}

export async function runCli(argv: readonly string[], io: CliIo, options: CliOptions = {}): Promise<number> {
  const parsed = parseArgs(argv);
  const locale = parsed.locale && isLocaleSupported(parsed.locale) ? parsed.locale : localeFromEnv();
  const t = translator(locale);

  if (parsed.help) {
    io.out(usage(t));
    return 0;
  }
  if (parsed.version) {
    io.out(`nblk ${VERSION}`);
    return 0;
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      if (error.startsWith("cli.unknownOption\u0000")) {
        io.err(t("cli.unknownOption", { option: error.split("\u0000")[1] ?? "" }));
      } else {
        io.err(t(error));
      }
    }
    io.err(usage(t));
    return 2;
  }
  if (!parsed.file) {
    io.err(t("cli.missingFile"));
    io.err(usage(t));
    return 2;
  }

  let source: string;
  let displayName: string;
  let baseDir: string;
  try {
    if (parsed.file === "-") {
      displayName = "<stdin>";
      baseDir = options.cwd ?? process.cwd();
      source = await readStdin();
    } else {
      const absolute = path.resolve(options.cwd ?? process.cwd(), parsed.file);
      displayName = parsed.file;
      baseDir = options.cwd ?? path.dirname(absolute);
      source = await fs.readFile(absolute, "utf8");
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    io.err(t(code === "ENOENT" ? "cli.fileNotFound" : "cli.fileRead", { file: parsed.file, message: messageOf(error) }));
    return 2;
  }

  const parsedDocument = parseNblk(source);
  if (!parsedDocument.ok) {
    io.err(t("cli.parseFailed", { file: displayName, line: parsedDocument.error.line, message: parsedDocument.error.message }));
    return 2;
  }
  const project = parsedDocument.document.project;

  if (parsed.check) {
    io.out(t("cli.checkOk", { blocks: countBlocks(project) }));
    return 0;
  }

  const writeLine = (text: string) => {
    if (parsed.json) emitJson(io, { kind: "log", text });
    else io.out(text);
  };
  const host = createNodeHost({ baseDir, write: writeLine });
  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const result = await runProject(project, {
    host,
    signal: controller.signal,
    onEvent(event) {
      if (event.kind === "log") {
        if (parsed.json) emitJson(io, { kind: "log", text: event.text });
        else io.out(event.text);
      } else if (event.kind === "error") {
        const message = t(event.messageKey, event.params);
        if (parsed.json) {
          emitJson(io, {
            kind: "error",
            message,
            messageKey: event.messageKey,
            blockId: event.blockId ?? null,
          });
        } else {
          io.err(`nblk: ${message}`);
        }
      } else if (event.kind === "status" && parsed.json) {
        emitJson(io, {
          kind: "status",
          status: event.status,
          durationMs: event.durationMs ?? null,
        });
      }
    },
  });

  if (result.status === "finished") return 0;
  if (result.status === "stopped") return 130;
  return 1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

