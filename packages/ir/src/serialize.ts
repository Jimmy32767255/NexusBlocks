import {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  IR_FORMAT,
  IR_VERSION,
  type BlockNode,
  type DebugState,
  type FunctionDef,
  type NexusDocument,
  type Project,
} from "./model.ts";

export type ParseResult =
  | { ok: true; document: NexusDocument; warnings: string[] }
  | { ok: false; error: string };

/**
 * Serialise with a fixed key order so that documents diff cleanly in git.
 * Human-readable: two-space indentation, trailing newline.
 */
export function serializeDocument(document: NexusDocument): string {
  return `${JSON.stringify(toOrderedDocument(document), null, 2)}\n`;
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(orderedProject(project), null, 2)}\n`;
}

function toOrderedDocument(document: NexusDocument): unknown {
  return {
    format: document.format,
    version: document.version,
    project: orderedProject(document.project),
  };
}

function orderedProject(project: Project): unknown {
  return {
    format: project.format,
    version: project.version,
    id: project.id,
    name: project.name,
    locale: project.locale,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    functions: project.functions.map(orderedFunction),
    scripts: project.scripts.map(orderedBlock),
    metadata: sortRecord(project.metadata),
  };
}

function orderedFunction(fn: FunctionDef): unknown {
  return {
    id: fn.id,
    name: fn.name,
    params: fn.params,
    returnType: fn.returnType,
    body: fn.body.map(orderedBlock),
  };
}

function orderedBlock(block: BlockNode): unknown {
  const out: Record<string, unknown> = { id: block.id, type: block.type };
  if (block.fields && Object.keys(block.fields).length > 0) {
    out.fields = sortRecord(block.fields);
  }
  if (block.inputs && Object.keys(block.inputs).length > 0) {
    const inputs: Record<string, unknown> = {};
    for (const [port, value] of Object.entries(block.inputs)) {
      inputs[port] = Array.isArray(value) ? value.map(orderedBlock) : orderedBlock(value);
    }
    out.inputs = inputs;
  }
  return out;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Parse and migrate a document from JSON text or an already decoded object. */
export function parseDocument(input: string | unknown): ParseResult {
  let raw: unknown;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      return { ok: false, error: `Invalid JSON: ${(error as Error).message}` };
    }
  } else {
    raw = input;
  }

  if (!isRecord(raw)) return { ok: false, error: "Document must be a JSON object" };
  if (raw.format !== DOCUMENT_FORMAT) {
    return {
      ok: false,
      error: `Not a Nexus Blocks document (format=${String(raw.format)})`,
    };
  }
  if (typeof raw.version !== "number" || raw.version > DOCUMENT_VERSION) {
    return {
      ok: false,
      error: `Unsupported document version: ${String(raw.version)}`,
    };
  }

  const projectRaw = raw.project;
  if (!isRecord(projectRaw)) return { ok: false, error: "Document has no project" };
  if (projectRaw.format !== IR_FORMAT) {
    return { ok: false, error: `Not a Nexus Blocks program (format=${String(projectRaw.format)})` };
  }
  if (typeof projectRaw.version !== "number" || projectRaw.version > IR_VERSION) {
    return { ok: false, error: `Unsupported program version: ${String(projectRaw.version)}` };
  }

  const warnings: string[] = [];
  const document = normalizeDocument(raw, warnings);
  return { ok: true, document, warnings };
}

function normalizeDocument(raw: Record<string, unknown>, warnings: string[]): NexusDocument {
  const projectRaw = raw.project as Record<string, unknown>;
  // Version 1 stored canvas positions and viewport; layout is automatic now.
  if (isRecord(raw.editor)) warnings.push("Dropped legacy canvas layout");
  const project = normalizeProject(projectRaw, warnings);
  const debug = normalizeDebug(raw.debug, warnings);
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    project,
    ...(debug ? { debug } : {}),
  };
}

function normalizeDebug(raw: unknown, warnings: string[]): DebugState | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    warnings.push("Dropped malformed debug metadata");
    return undefined;
  }
  const rawIds = Array.isArray(raw.breakpoints) ? raw.breakpoints : [];
  const breakpoints: string[] = [];
  for (const id of rawIds) {
    if (typeof id === "string" && !breakpoints.includes(id)) breakpoints.push(id);
  }
  return { breakpoints };
}

function normalizeProject(raw: Record<string, unknown>, warnings: string[]): Project {
  const now = new Date().toISOString();
  if (raw.variables !== undefined) {
    warnings.push("Dropped legacy variable declarations; variables are declared at run time now");
  }

  const functionsRaw = Array.isArray(raw.functions) ? raw.functions : [];
  const functions: FunctionDef[] = [];
  for (const item of functionsRaw) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string") {
      warnings.push("Dropped a malformed function definition");
      continue;
    }
    functions.push({
      id: item.id,
      name: item.name,
      params: Array.isArray(item.params) ? (item.params as FunctionDef["params"]) : [],
      returnType: (item.returnType as FunctionDef["returnType"]) ?? "any",
      body: normalizeStack(item.body, warnings),
    });
  }

  return {
    format: IR_FORMAT,
    version: IR_VERSION,
    id: typeof raw.id === "string" ? raw.id : "p_missing",
    name: typeof raw.name === "string" ? raw.name : "Untitled",
    locale: typeof raw.locale === "string" ? raw.locale : "zh-CN",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    functions,
    scripts: normalizeStack(raw.scripts, warnings),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
}

function normalizeStack(value: unknown, warnings: string[]): BlockNode[] {
  if (!Array.isArray(value)) return [];
  const out: BlockNode[] = [];
  for (const item of value) {
    const node = normalizeBlock(item, warnings);
    if (node) out.push(node);
  }
  return out;
}

function normalizeBlock(value: unknown, warnings: string[]): BlockNode | null {
  if (!isRecord(value)) {
    warnings.push("Dropped a malformed block");
    return null;
  }
  if (typeof value.id !== "string" || typeof value.type !== "string") {
    warnings.push("Dropped a block without id/type");
    return null;
  }
  const node: BlockNode = { id: value.id, type: value.type };
  if (isRecord(value.fields)) node.fields = value.fields as BlockNode["fields"];
  if (isRecord(value.inputs)) {
    const inputs: Record<string, BlockNode | BlockNode[]> = {};
    for (const [port, child] of Object.entries(value.inputs)) {
      if (Array.isArray(child)) {
        inputs[port] = normalizeStack(child, warnings);
      } else {
        const nested = normalizeBlock(child, warnings);
        if (nested) inputs[port] = nested;
      }
    }
    node.inputs = inputs;
  }
  return node;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

