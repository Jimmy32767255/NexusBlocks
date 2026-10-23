import {
  VALUE_TYPES,
  type BlockNode,
  type BlockSchema,
  type FieldValue,
  type PortDef,
  type ValueType,
} from "./model.ts";
import { walkBlocks } from "./traverse.ts";

/** The hat block that defines a function on the canvas. */
export const FUNCTION_DEFINE_TYPE = "func.define" as const;
/** Expression/statement prefix for generated function call blocks. */
export const FUNCTION_CALL_PREFIX = "func.call:" as const;
/** Expression that reads a parameter inside a function body. */
export const FUNCTION_PARAM_TYPE = "func.param" as const;
/** Statement that leaves the current function with a value. */
export const FUNCTION_RETURN_TYPE = "func.return" as const;
export const MAX_PARAMS = 8;

export interface FunctionParam {
  name: string;
  type: ValueType;
}

export interface FunctionDecl {
  /** The defining block's id; call blocks reference it. */
  id: string;
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
  const returnType = isValueType(node.fields?.returnType) ? node.fields!.returnType : "any";
  return {
    decl: {
      id: node.id,
      name: name || node.id,
      params: parsed.params,
      returnType: returnType as ValueType,
      node,
    },
    errors: parsed.errors,
  };
}

/** Functions defined by top-level `func.define` hats, in canvas order. */
export function collectFunctions(scripts: readonly BlockNode[]): FunctionDecl[] {
  return scripts
    .filter((node) => node.type === FUNCTION_DEFINE_TYPE)
    .map((node) => functionDeclFromNode(node).decl);
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
export function createFunctionCallSchema(decl: FunctionDecl): BlockSchema {
  const ports = decl.params.map(paramPort);
  return {
    type: functionCallType(decl.id),
    kind: decl.returnType === "void" ? "statement" : "expression",
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
    if (node.type !== FUNCTION_DEFINE_TYPE) continue;
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
