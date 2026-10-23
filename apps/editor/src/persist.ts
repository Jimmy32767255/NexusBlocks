import { parseDocument, serializeDocument, type NexusDocument } from "@nexus/ir";

const AUTOSAVE_KEY = "nexus-blocks:autosave";

export type OpenResult =
  | { ok: true; document: NexusDocument; warnings: string[] }
  | { ok: false; error: string };

export function loadAutosave(): NexusDocument | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = parseDocument(raw);
    return parsed.ok ? parsed.document : null;
  } catch {
    return null;
  }
}

export function saveAutosave(doc: NexusDocument): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeDocument(doc));
  } catch {
    // Quota or private mode: autosave is best-effort.
  }
}

export function downloadDocument(doc: NexusDocument): void {
  const blob = new Blob([serializeDocument(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  const name = doc.project.name.trim() || "nexus-blocks";
  anchor.href = url;
  anchor.download = `${name}.nexusblocks.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Ask the user for a `.nexusblocks.json` file; `null` when cancelled. */
export function pickDocument(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((text) => {
          const parsed = parseDocument(text);
          resolve(parsed.ok ? { ok: true, document: parsed.document, warnings: parsed.warnings } : parsed);
        })
        .catch((error: unknown) => {
          resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
    });
    input.click();
  });
}
