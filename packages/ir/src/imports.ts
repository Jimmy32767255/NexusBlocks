import type { BlockNode } from "./model.ts";

/** Hat block: import every function from another program file. */
export const IMPORT_ALL_TYPE = "import.all" as const;
/** Hat block: import one named function from another program file. */
export const IMPORT_NAMED_TYPE = "import.named" as const;
/** Hat block: import one function under a local alias. */
export const IMPORT_ALIAS_TYPE = "import.alias" as const;

export type ImportKind = "all" | "named" | "alias";

export const IMPORT_TYPES: readonly string[] = [
  IMPORT_ALL_TYPE,
  IMPORT_NAMED_TYPE,
  IMPORT_ALIAS_TYPE,
];

export interface ImportSpec {
  kind: ImportKind;
  /** File path as typed by the user; the host resolves it. */
  path: string;
  /** Function name for named/alias imports. */
  name: string;
  /** Local name for alias imports (defaults to `name`). */
  alias: string;
  blockId: string;
}

export function isImportType(type: string): boolean {
  return IMPORT_TYPES.includes(type);
}

export function importKindOf(type: string): ImportKind | null {
  if (type === IMPORT_ALL_TYPE) return "all";
  if (type === IMPORT_NAMED_TYPE) return "named";
  if (type === IMPORT_ALIAS_TYPE) return "alias";
  return null;
}

/**
 * Read the import declaration stored on a block. Returns null for other
 * blocks and when the file field is empty (validation reports that case).
 */
export function importSpecOf(node: BlockNode): ImportSpec | null {
  const kind = importKindOf(node.type);
  if (!kind) return null;
  const path = String(node.fields?.file ?? "").trim();
  const name = String(node.fields?.name ?? "").trim();
  const alias = String(node.fields?.alias ?? "").trim();
  return { kind, path, name, alias: alias || name, blockId: node.id };
}

/** Import declarations on the top level of the canvas, in canvas order. */
export function topLevelImports(scripts: readonly BlockNode[]): ImportSpec[] {
  const specs: ImportSpec[] = [];
  for (const node of scripts) {
    const spec = importSpecOf(node);
    if (spec) specs.push(spec);
  }
  return specs;
}
