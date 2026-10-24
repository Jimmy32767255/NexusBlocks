import { parseDocument, parseNblk, printNblk, serializeDocument, type NblkSchemaSource, type NexusDocument } from "@nexus/ir";

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

/** Suggested file name for a project, without directories. */
export function projectFileName(doc: NexusDocument): string {
  const name = doc.project.name.trim().replace(/[\\/:*?"<>|]/g, "-") || "nexus-blocks";
  return `${name}.nblk`;
}

/**
 * Browser download. The anchor has to be in the document for Firefox and
 * WebKit, and the object URL must outlive the navigation the click starts.
 */
export function downloadDocument(doc: NexusDocument, schemas?: NblkSchemaSource): void {
  const blob = new Blob([printNblk(doc, schemas)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = globalThis.document.createElement("a");
  anchor.href = url;
  anchor.download = projectFileName(doc);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  globalThis.document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * Ask for a `.nblk` file; `null` when cancelled. Older `.json` documents are
 * still accepted so existing projects keep opening.
 */
export function pickDocument(accept = ".nblk,.json,text/plain,application/json"): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    globalThis.document.body.append(input);
    const done = (result: OpenResult | null): void => {
      input.remove();
      resolve(result);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      file
        .text()
        .then((text) => done(readDocument(text)))
        .catch((error: unknown) => {
          done({ ok: false, error: error instanceof Error ? error.message : String(error) });
        });
    });
    // A cancelled picker fires no event in most browsers; drop the node when
    // the window regains focus so it cannot pile up.
    globalThis.addEventListener("focus", () => setTimeout(() => input.remove(), 1000), { once: true });
    input.click();
  });
}

/** Read a document from raw text: `.nblk` first, legacy JSON as fallback. */
export function readDocument(text: string): OpenResult {
  if (text.trimStart().startsWith("{")) {
    const parsed = parseDocument(text);
    return parsed.ok ? { ok: true, document: parsed.document, warnings: parsed.warnings } : parsed;
  }
  const parsed = parseNblk(text);
  if (parsed.ok) return { ok: true, document: parsed.document, warnings: parsed.warnings };
  return { ok: false, error: `Line ${parsed.error.line}: ${parsed.error.message}` };
}
