import {
  VALUE_TYPES,
  type BlockNode,
  type Project,
  type BlockSchema,
  type FieldValue,
  type PortDef,
  type ValueType,
} from "./model.ts";
import { walkBlocks, walkProject } from "./traverse.ts";

/** Legacy hat that defines a function; read as a value function. */
export const FUNCTION_DEFINE_TYPE = "func.define" as const;
/** Hat defining a function that returns a value. */
export const FUNCTION_DEFINE_VALUE_TYPE = "func.define_value" as const;
/** Hat defining a function that is used as a statement. */
export const FUNCTION_DEFINE_ACTION_TYPE = "func.define_action" as const;
export const FUNCTION_DEFINE_TYPES = [
  FUNCTION_DEFINE_TYPE,
  FUNCTION_DEFINE_VALUE_TYPE,
  FUNCTION_DEFINE_ACTION_TYPE,
] as const;
/** Expression/statement prefix for generated function call blocks. */
export const FUNCTION_CALL_PREFIX = "func.call:" as const;
/** Calls parsed from text before imports are resolved carry a function name. */
export const FUNCTION_NAME_CALL_PREFIX = "func.call:name:" as const;
/** Expression that reads a parameter inside a function body. */
export const FUNCTION_PARAM_TYPE = "func.param" as const;
/** Statement that leaves the current function with a value. */
export const FUNCTION_RETURN_TYPE = "func.return" as const;
export const MAX_PARAMS = 8;

export interface FunctionParam {
  name: string;
  type: ValueType;
}

export type FunctionKind = "value" | "action";

export interface FunctionDecl {
  /** The defining block's id; call blocks reference it. */
  id: string;
  kind: FunctionKind;
  name: string;
  params: FunctionParam[];
  returnType: ValueType;
  /** The `func.define` block, whose `body` port holds the statements. */
  node: BlockNode;
}

const PARAM_LIST = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Parse `a: number, b: text` into parameters. Invalid entries are reported. */
export function parseParams(text: string): { params: FunctionParam[]; errors: string[] } {
  const params: FunctionParam[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const [namePart, typePart, ...rest] = entry.split(":");
    const name = namePart?.trim() ?? "";
    if (!PARAM_LIST.test(name)) {
      errors.push(`Invalid parameter name: ${name || entry}`);
      continue;
    }
    if (seen.has(name)) {
      errors.push(`Duplicate parameter: ${name}`);
      continue;
    }
    seen.add(name);
    let type: ValueType = "any";
    if (typePart !== undefined) {
      const candidate = typePart.trim();
      if (!VALUE_TYPES.includes(candidate as ValueType)) {
        errors.push(`Unknown parameter type: ${candidate}`);
        continue;
      }
      if (candidate === "void") {
        errors.push(`Parameters cannot be void: ${name}`);
        continue;
      }
      type = candidate as ValueType;
    }
    params.push({ name, type });
    if (params.length > MAX_PARAMS) {
      errors.push(`Too many parameters (maximum ${MAX_PARAMS})`);
      break;
    }
  }
  return errors.length > 0 ? { params: [], errors } : { params, errors };
}

export function formatParams(params: readonly FunctionParam[]): string {
  return params.map((param) => `${param.name}: ${param.type}`).join(", ");
}

export function isValueType(value: unknown): value is ValueType {
  return typeof value === "string" && VALUE_TYPES.includes(value as ValueType);
}

/** Build the schema for `func.define` given already-saved fields. */
export function functionDeclFromNode(node: BlockNode): { decl: FunctionDecl; errors: string[] } {
  const name = String(node.fields?.name ?? "").trim();
  const parsed = parseParams(String(node.fields?.params ?? ""));
  const kind: FunctionKind = node.type === FUNCTION_DEFINE_ACTION_TYPE ? "action" : "value";
  const savedReturn = isValueType(node.fields?.returnType) ? node.fields!.returnType : "any";
  const returnType: ValueType = kind === "action" ? "void" : savedReturn;
  return {
    decl: {
      id: node.id,
      kind,
      name: name || node.id,
      params: parsed.params,
      returnType,
      node,
    },
    errors: parsed.errors,
  };
}

/** Functions defined by top-level `func.define` hats, in canvas order. */
export function collectFunctions(scripts: readonly BlockNode[]): FunctionDecl[] {
  return scripts
    .filter((node) => isFunctionDefine(node.type))
    .map((node) => functionDeclFromNode(node).decl);
}

export function isFunctionDefine(type: string): boolean {
  return (FUNCTION_DEFINE_TYPES as readonly string[]).includes(type);
}

export function functionCallType(functionId: string): string {
  return `${FUNCTION_CALL_PREFIX}${functionId}`;
}

export function functionIdFromType(type: string): string | null {
  return type.startsWith(FUNCTION_CALL_PREFIX) ? type.slice(FUNCTION_CALL_PREFIX.length) : null;
}

function paramPort(param: FunctionParam): PortDef {
  const port: PortDef = {
    name: param.name,
    label: param.name,
    kind: "value",
    type: param.type,
  };
  if (param.type === "text") port.default = "";
  else if (param.type === "number") port.default = 0;
  else if (param.type === "boolean") port.default = false;
  return port;
}

/** Toolbox/canvas schema for a call to the given function. */
export function functionNameCallType(name: string): string {
  return `${FUNCTION_NAME_CALL_PREFIX}${name}`;
}

export function functionNameCallOf(type: string): string | null {
  return type.startsWith(FUNCTION_NAME_CALL_PREFIX) ? type.slice(FUNCTION_NAME_CALL_PREFIX.length) : null;
}

/**
 * Rewrite name-based calls (produced by the text parser) into id-based calls
 * once all functions are known. Arguments were parsed into `arg0..argN` and
 * are renamed to the declaration's parameter names.
 */
export function bindNameCalls(project: Project): { name: string; blockId: string }[] {
  const byName = new Map<string, FunctionDecl>();
  for (const decl of collectFunctions(project.scripts)) byName.set(decl.name, decl);
  const missing: { name: string; blockId: string }[] = [];
  walkProject(project, (node) => {
    const name = functionNameCallOf(node.type);
    if (name === null) return;
    const decl = byName.get(name);
    if (!decl) {
      missing.push({ name, blockId: node.id });
      return;
    }
    node.type = functionCallType(decl.id);
    const fields = node.fields;
    if (!fields) return;
    decl.params.forEach((param, index) => {
      const key = `arg${index}`;
      if (key in fields) {
        fields[param.name] = fields[key]!;
        delete fields[key];
      }
    });
  });
  return missing;
}

export function createFunctionCallSchema(decl: FunctionDecl): BlockSchema {
  const ports = decl.params.map(paramPort);
  return {
    type: functionCallType(decl.id),
    kind: decl.kind === "action" ? "statement" : "expression",
    category: "functions",
    label: decl.name,
    output: decl.returnType,
    fields: [],
    ports,
  };
}

/** Lookup table from block id to the function whose body contains it. */
export function functionOwners(decls: readonly FunctionDecl[]): Map<string, FunctionDecl> {
  const owners = new Map<string, FunctionDecl>();
  for (const decl of decls) {
    walkBlocks(decl.node.inputs?.body as BlockNode[] ?? [], (node) => owners.set(node.id, decl));
  }
  return owners;
}

export interface FunctionScan {
  decls: FunctionDecl[];
  /** Diagnostics-friendly descriptions of malformed definitions. */
  errors: { blockId: string; message: string }[];
  schemas: Map<string, BlockSchema>;
}

/** One pass over all scripts: declarations, schema table and parse errors. */
export function scanFunctions(scripts: readonly BlockNode[]): FunctionScan {
  const decls: FunctionDecl[] = [];
  const errors: { blockId: string; message: string }[] = [];
  const schemas = new Map<string, BlockSchema>();
  for (const node of scripts) {
    if (!isFunctionDefine(node.type)) continue;
    const { decl, errors: parseErrors } = functionDeclFromNode(node);
    for (const message of parseErrors) errors.push({ blockId: node.id, message });
    decls.push(decl);
    schemas.set(functionCallType(decl.id), createFunctionCallSchema(decl));
  }
  return { decls, errors, schemas };
}

export function literalField(node: BlockNode, name: string): FieldValue | undefined {
  return node.fields?.[name];
}
