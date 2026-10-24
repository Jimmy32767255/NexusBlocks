import {
  CONSOLE_PRINT,
  FS_CAPABILITIES,
  OS_CAPABILITIES,
  HostError,
  type HostBridge,
  type HostRequest,
  type RuntimeEvent,
} from "@nexus/engine";
import type { Value } from "@nexus/ir";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface DesktopResponse {
  ok: boolean;
  value?: Value;
  error?: { messageKey: string; params?: Record<string, string | number> };
}

/** True when the editor bundle is running inside the Tauri WebView. */
export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface SavedFile {
  path: string;
}

export interface OpenedFile {
  path: string;
  content: string;
}

function unwrap<T>(response: unknown): T | null {
  const value = response as DesktopResponse | null;
  if (value?.ok) return (value.value ?? null) as T | null;
  throw new HostError(
    value?.error?.messageKey ?? "runtime.error.capability",
    value?.error?.params ?? {},
  );
}

/**
 * Project files go through native dialogs: a WebView cannot open a system
 * file picker, and WebKitGTK ignores `<a download>`, so the browser helpers
 * in `persist.ts` would report success while writing nothing.
 */
export function createDesktopFiles(invoke: Invoke | null = defaultInvoke) {
  return {
    /** `null` when the user cancels the save dialog. */
    async save(content: string, suggestedName: string): Promise<SavedFile | null> {
      if (!invoke) return null;
      return unwrap<SavedFile>(await invoke("project_save", { content, suggestedName }));
    },
    /** `null` when the user cancels the open dialog. */
    async open(): Promise<OpenedFile | null> {
      if (!invoke) return null;
      return unwrap<OpenedFile>(await invoke("project_open"));
    },
  };
}

export type DesktopFiles = ReturnType<typeof createDesktopFiles>;

function display(value: Value): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function defaultInvoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args as never);
}

/**
 * Host backed by the desktop shell: console lines stay in the editor, every
 * file capability is forwarded to Rust and acts on the real file system.
 */
export function createDesktopHost(
  sink: (event: RuntimeEvent) => void,
  invoke: Invoke | null = defaultInvoke,
): HostBridge | null {
  if (!invoke) return null;
  return {
    name: "desktop",
    capabilities() {
      return [CONSOLE_PRINT, ...FS_CAPABILITIES, ...OS_CAPABILITIES];
    },
    async invoke(request: HostRequest): Promise<Value> {
      if (request.capability === "console.print") {
        const text = request.args.map(display).join(" ");
        sink({ kind: "log", level: "info", text, blockId: request.blockId, time: Date.now() });
        return null;
      }
      // Rust writes text: match the browser host by rendering values the same
      // way the console does (objects as JSON).
      const args =
        request.capability === "fs.write"
          ? [request.args[0], display(request.args[1] as Value)]
          : request.args;
      const response = (await invoke("capability_invoke", {
        request: {
          capability: request.capability,
          args,
          blockId: request.blockId,
        },
      })) as DesktopResponse | null;
      if (response?.ok) return response.value ?? null;
      throw new HostError(response?.error?.messageKey ?? "runtime.error.capability", response?.error?.params ?? {});
    },
  };
}


export interface DesktopCli {
  path: string;
  run(source: string, locale: string, onEvent: (event: Value) => void): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Stream a run through the standalone `nblk` interpreter. Returns null when the
 * editor is not inside the desktop shell or the CLI is not installed.
 */
export async function createDesktopCli(): Promise<DesktopCli | null> {
  if (!isDesktopShell()) return null;
  try {
    const [{ invoke }, { listen }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/event"),
    ]);
    const path = await invoke<string | null>("cli_status");
    if (!path) return null;
    return {
      path,
      async run(source, locale, onEvent) {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          let unlistens: Array<() => void> = [];
          const finish = () => {
            settled = true;
            for (const unlisten of unlistens) unlisten();
            resolve();
          };
          Promise.all([
            listen<Value>("cli-event", (event) => onEvent(event.payload)),
            listen("cli-exit", finish),
          ])
            .then((registered) => {
              unlistens = registered;
              if (settled) for (const unlisten of registered) unlisten();
            })
            .catch(reject);
          invoke("cli_run", { source, locale }).catch((error) => {
            for (const unlisten of unlistens) unlisten();
            reject(error);
          });
        });
      },
      async stop() {
        await invoke("cli_stop");
      },
    };
  } catch {
    return null;
  }
}
