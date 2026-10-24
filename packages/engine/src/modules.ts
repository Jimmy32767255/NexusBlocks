import {
  isFunctionDefine,
  parseNblk,
  functionDeclFromNode,
  importSpecOf,
  parseDocument,
  type ImportSpec,
  type BlockNode,
  type Project,
  type VariableDef,
} from "@nexus/ir";
import { HostError } from "./host.ts";
import type { HostBridge } from "./types.ts";

/** One import failure, translated by the UI in the current locale. */
export interface ImportError {
  messageKey: string;
  params: Record<string, string | number>;
  blockId?: string;
}

export interface ResolvedImports {
  /** The project with imported functions and variables merged in. */
  project: Project;
  /** Imported function ids, in import order. */
  functionIds: string[];
  /** Imported file paths (deduplicated), useful for reload prompts. */
  files: string[];
  errors: ImportError[];
}

export interface ResolveOptions {
  host: HostBridge;
  /** Guards against pathological import chains. */
  maxDepth?: number;
}

interface Pending {
  project: Project;
  depth: number;
}

const DEFAULT_MAX_DEPTH = 8;

/**
 * Read every top-level import of a project (recursively), then append the
 * selected functions and their variables to a copy of the project.
 *
 * Imported functions keep their ids, so `func.call:<id>` keeps working and the
 * existing registry/interpreter need no special cases at call time.
 */
export async function resolveImports(
  project: Project,
  options: ResolveOptions,
): Promise<ResolvedImports> {
  const host = options.host;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const merged: Project = JSON.parse(JSON.stringify(project)) as Project;
  const errors: ImportError[] = [];
  const files: string[] = [];
  const visitedFiles = new Set<string>();
  const knownFunctions = new Set(collectFunctionIds(merged));
  const knownVariables = new Set(merged.variables.map((variable) => variable.id));
  const importedFunctions: string[] = [];
  const queue: Pending[] = [{ project, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const node of current.project.scripts) {
      const spec = importSpecOf(node);
      if (!spec) continue;
      if (!spec.path) {
        errors.push({ messageKey: "runtime.error.importNoFile", params: {}, blockId: spec.blockId });
        continue;
      }
      if (current.depth >= maxDepth) {
        errors.push({
          messageKey: "runtime.error.importDepth",
          params: { limit: maxDepth, file: spec.path },
          blockId: spec.blockId,
        });
        continue;
      }
      if (visitedFiles.has(spec.path)) continue;
      visitedFiles.add(spec.path);

      let text: string;
      try {
        const value = await host.invoke({ capability: "fs.read", args: [spec.path], blockId: spec.blockId });
        if (typeof value !== "string") throw new HostError("runtime.error.importUnreadable", { file: spec.path });
        text = value;
      } catch (error) {
        errors.push(readError(error, spec.blockId, spec.path));
        continue;
      }

      const parsed = spec.path.endsWith(".nblk") ? parseNblk(text) : parseDocument(text);
      if (!parsed.ok) {
        const detail = parsed.error;
        errors.push({
          messageKey: "runtime.error.importInvalid",
          params: {
            file: spec.path,
            message: typeof detail === "string" ? detail : `line ${detail.line}: ${detail.message}`,
          },
          blockId: spec.blockId,
        });
        continue;
      }
      files.push(spec.path);
      const moduleProject = parsed.document.project;
      const definitions = moduleProject.scripts.filter(
        (candidate) => isFunctionDefine(candidate.type),
      );
      const selected = selectFunctions(definitions, spec, errors);
      for (const definition of selected) {
        if (knownFunctions.has(definition.id)) continue;
        const copy = JSON.parse(JSON.stringify(definition)) as BlockNode;
        if (spec.kind === "alias" && spec.alias) {
          copy.fields = { ...copy.fields, name: spec.alias };
        }
        merged.scripts.push(copy);
        knownFunctions.add(definition.id);
        importedFunctions.push(definition.id);
      }
      for (const variable of moduleProject.variables) {
        if (knownVariables.has(variable.id)) continue;
        merged.variables.push(variable as VariableDef);
        knownVariables.add(variable.id);
      }
      queue.push({ project: moduleProject, depth: current.depth + 1 });
    }
  }

  return { project: merged, functionIds: importedFunctions, files, errors };
}

function selectFunctions(
  definitions: readonly BlockNode[],
  spec: ImportSpec,
  errors: ImportError[],
): BlockNode[] {
  if (!spec || spec.kind === "all") return [...definitions];
  const wanted = spec.name;
  if (!wanted) {
    errors.push({ messageKey: "runtime.error.importNoName", params: {}, blockId: spec.blockId });
    return [];
  }
  const matches = definitions.filter((node) => functionDeclFromNode(node).decl.name === wanted);
  if (matches.length === 0) {
    errors.push({
      messageKey: "runtime.error.importMissingFunction",
      params: { name: wanted, file: spec.path },
      blockId: spec.blockId,
    });
  }
  return matches.slice(0, 1);
}

function readError(error: unknown, blockId: string, file: string): ImportError {
  if (error instanceof HostError) {
    return { messageKey: error.messageKey, params: { ...error.params, file }, blockId };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { messageKey: "runtime.error.importUnreadable", params: { file, message }, blockId };
}

function collectFunctionIds(project: Project): string[] {
  return project.scripts
    .filter((node) => isFunctionDefine(node.type))
    .map((node) => node.id);
}

