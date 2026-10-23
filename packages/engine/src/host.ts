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

export const CONSOLE_PRINT: CapabilityDescriptor = {
  id: "console.print",
  descriptionKey: "capability.console.print",
  risk: "none",
};

/**
 * In-process host used by the editor and by embedding applications. It owns
 * no ambient authority: adding files or processes later means adding a
 * capability here (or swapping in the Tauri host), not changing the language.
 */
export function createLocalHost(sink: (event: RuntimeEvent) => void): HostBridge {
  return {
    name: "local",
    capabilities() {
      return [CONSOLE_PRINT];
    },
    async invoke(request: HostRequest): Promise<Value> {
      switch (request.capability) {
        case "console.print": {
          const text = request.args.map(display).join(" ");
          sink({ kind: "log", level: "info", text, blockId: request.blockId, time: Date.now() });
          return null;
        }
        default:
          throw new CapabilityUnavailableError(request.capability);
      }
    },
  };
}

function display(value: Value): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(display).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
