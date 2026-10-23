import {
  CONSOLE_PRINT,
  FS_CAPABILITIES,
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
 * file capability is forwarded to Rust, which owns the workspace directory.
 */
export function createDesktopHost(
  sink: (event: RuntimeEvent) => void,
  invoke: Invoke | null = defaultInvoke,
): HostBridge | null {
  if (!invoke) return null;
  return {
    name: "desktop",
    capabilities() {
      return [CONSOLE_PRINT, ...FS_CAPABILITIES];
    },
    async invoke(request: HostRequest): Promise<Value> {
      if (request.capability === "console.print") {
        const text = request.args.map(display).join(" ");
        sink({ kind: "log", level: "info", text, blockId: request.blockId, time: Date.now() });
        return null;
      }
      const response = (await invoke("capability_invoke", {
        request: {
          capability: request.capability,
          args: request.args,
          blockId: request.blockId,
        },
      })) as DesktopResponse | null;
      if (response?.ok) return response.value ?? null;
      throw new HostError(response?.error?.messageKey ?? "runtime.error.capability", response?.error?.params ?? {});
    },
  };
}

/** Ask the shell for a new workspace directory; resolves null when cancelled. */
export async function chooseWorkspace(invoke: Invoke = defaultInvoke): Promise<string | null> {
  const response = (await invoke("workspace_choose")) as { path?: string | null } | null;
  return response?.path ?? null;
}
