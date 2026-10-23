import type {
  BlockNode,
  BlockSchema,
  Project,
  ValueType,
} from "./model.ts";
import { isAssignable } from "./values.ts";
import { walkBlocks } from "./traverse.ts";
import {
  FUNCTION_PARAM_TYPE,
  FUNCTION_RETURN_TYPE,
  functionOwners,
  scanFunctions,
} from "./functions.ts";

export type DiagnosticCode =
  | "project.format"
  | "project.version"
  | "project.empty"
  | "block.duplicateId"
  | "block.unknownType"
  | "block.kindMismatch"
  | "block.unknownField"
  | "block.missingField"
  | "block.invalidNumber"
  | "block.invalidOption"
  | "block.invalidVariable"
  | "port.unknown"
  | "port.expectedValue"
  | "port.expectedStack"
  | "port.typeMismatch"
  | "variable.duplicateName"
  | "variable.invalidName"
  | "function.invalidParams"
  | "function.unknownParam";

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: DiagnosticCode;
  /** Stable English message; the UI localises by `code` + `params`. */
  message: string;
  path: string;
  blockId?: string;
  params?: Record<string, string | number>;
}

/** Minimal view of a block registry that validation needs. */
export interface SchemaSource {
  get(type: string): BlockSchema | undefined;
}

const VARIABLE_NAME = /^[\p{L}_][\p{L}\p{N}_]*$/u;

/** Structural and best-effort type validation of a whole project. */
export function validateProject(project: Project, schemas: SchemaSource): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (project.format !== "nexus-blocks/ir") {
    diagnostics.push({
      severity: "error",
      code: "project.format",
      message: `Unknown program format: ${project.format}`,
      path: "project.format",
    });
  }

  const seenIds = new Set<string>();
  const variableNames = new Map<string, string>();

  project.variables.forEach((variable, index) => {
    const path = `variables[${index}]`;
    if (!VARIABLE_NAME.test(variable.name)) {
      diagnostics.push({
        severity: "error",
        code: "variable.invalidName",
        message: `Invalid variable name: ${variable.name}`,
        path,
        params: { name: variable.name },
      });
    }
    const previous = variableNames.get(variable.name);
    if (previous) {
      diagnostics.push({
        severity: "error",
        code: "variable.duplicateName",
        message: `Duplicate variable name: ${variable.name}`,
        path,
        params: { name: variable.name },
      });
    } else {
      variableNames.set(variable.name, variable.id);
    }
  });

  if (project.scripts.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "project.empty",
      message: "The program has no scripts yet",
      path: "scripts",
    });
  }

  const variableIds = new Set(project.variables.map((variable) => variable.id));
  const functionScan = scanFunctions(project.scripts);
  const owners = functionOwners(functionScan.decls);
  const lookup = (type: string): BlockSchema | undefined =>
    schemas.get(type) ?? functionScan.schemas.get(type);

  for (const error of functionScan.errors) {
    diagnostics.push({
      severity: "error",
      code: "function.invalidParams",
      message: error.message,
      path: `scripts.${error.blockId}.fields.params`,
      blockId: error.blockId,
      params: { message: error.message },
    });
  }

  walkBlocks(
    project.scripts,
    (node, ctx) => {
      if (seenIds.has(node.id)) {
        diagnostics.push({
          severity: "error",
          code: "block.duplicateId",
          message: `Duplicate block id: ${node.id}`,
          path: ctx.path,
          blockId: node.id,
        });
      }
      seenIds.add(node.id);

      const schema = lookup(node.type);
      if (!schema) {
        diagnostics.push({
          severity: "error",
          code: "block.unknownType",
          message: `Unknown block type: ${node.type}`,
          path: ctx.path,
          blockId: node.id,
          params: { type: node.type },
        });
        return;
      }

      checkFunctionScope(node, owners, ctx.path, diagnostics);
      checkKind(node, schema, ctx.parent === null, ctx.path, diagnostics);
      checkFields(node, schema, variableIds, ctx.path, diagnostics);
      checkInputs(node, schema, schemas, ctx.path, diagnostics);
    },
    null,
    null,
    "scripts",
  );

  project.functions.forEach((fn, fnIndex) => {
    walkBlocks(
      fn.body,
      (node, ctx) => {
        if (seenIds.has(node.id)) {
          diagnostics.push({
            severity: "error",
            code: "block.duplicateId",
            message: `Duplicate block id: ${node.id}`,
            path: ctx.path,
            blockId: node.id,
          });
        }
        seenIds.add(node.id);
        const schema = lookup(node.type);
        if (!schema) {
          diagnostics.push({
            severity: "error",
            code: "block.unknownType",
            message: `Unknown block type: ${node.type}`,
            path: ctx.path,
            blockId: node.id,
            params: { type: node.type },
          });
          return;
        }
        checkKind(node, schema, false, ctx.path, diagnostics);
        checkFields(node, schema, variableIds, ctx.path, diagnostics);
        checkInputs(node, schema, schemas, ctx.path, diagnostics);
      },
      null,
      null,
      `functions[${fnIndex}].body`,
    );
  });

  return diagnostics;
}

function checkFunctionScope(
  node: BlockNode,
  owners: Map<string, { params: { name: string }[] }>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (node.type !== FUNCTION_PARAM_TYPE && node.type !== FUNCTION_RETURN_TYPE) return;
  const owner = owners.get(node.id);
  if (!owner) {
    if (node.type === FUNCTION_PARAM_TYPE) {
      diagnostics.push({
        severity: "error",
        code: "function.unknownParam",
        message: "Parameter blocks may only be used inside a function",
        path,
        blockId: node.id,
        params: { name: String(node.fields?.name ?? "") },
      });
    }
    return;
  }
  if (node.type === FUNCTION_PARAM_TYPE) {
    const name = String(node.fields?.name ?? "");
    if (!owner.params.some((param) => param.name === name)) {
      diagnostics.push({
        severity: "error",
        code: "function.unknownParam",
        message: `Function has no parameter named ${name}`,
        path,
        blockId: node.id,
        params: { name },
      });
    }
  }
}

function checkKind(
  node: BlockNode,
  schema: BlockSchema,
  atTopLevel: boolean,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (atTopLevel && schema.kind !== "hat") {
    diagnostics.push({
      severity: "error",
      code: "block.kindMismatch",
      message: `Top-level scripts must start with a hat block, found ${schema.kind}`,
      path,
      blockId: node.id,
      params: { type: node.type, expected: "hat", actual: schema.kind },
    });
  }
}

function checkFields(
  node: BlockNode,
  schema: BlockSchema,
  variableIds: Set<string>,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const fields = node.fields ?? {};
  for (const def of schema.fields) {
    const value = fields[def.name];
    if (value === undefined) {
      if (def.required) {
        diagnostics.push({
          severity: "error",
          code: "block.missingField",
          message: `Missing required field "${def.name}"`,
          path: `${path}.fields.${def.name}`,
          blockId: node.id,
          params: { field: def.name, type: node.type },
        });
      }
      continue;
    }
    const fieldPath = `${path}.fields.${def.name}`;
    switch (def.kind) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          diagnostics.push({
            severity: "error",
            code: "block.invalidNumber",
            message: `Field "${def.name}" must be a finite number`,
            path: fieldPath,
            blockId: node.id,
            params: { field: def.name },
          });
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          diagnostics.push({
            severity: "error",
            code: "block.invalidOption",
            message: `Field "${def.name}" must be a boolean`,
            path: fieldPath,
            blockId: node.id,
            params: { field: def.name, value: String(value) },
          });
        }
        break;
      case "select":
        if (!def.options?.some((option) => option.value === value)) {
          diagnostics.push({
            severity: "error",
            code: "block.invalidOption",
            message: `Field "${def.name}" has an unknown option: ${String(value)}`,
            path: fieldPath,
            blockId: node.id,
            params: { field: def.name, value: String(value) },
          });
        }
        break;
      case "variable":
        if (typeof value !== "string" || !variableIds.has(value)) {
          diagnostics.push({
            severity: "error",
            code: "block.invalidVariable",
            message: `Field "${def.name}" references a missing variable`,
            path: fieldPath,
            blockId: node.id,
            params: { field: def.name },
          });
        }
        break;
      case "text":
        if (typeof value !== "string") {
          diagnostics.push({
            severity: "warning",
            code: "block.kindMismatch",
            message: `Field "${def.name}" should be text`,
            path: fieldPath,
            blockId: node.id,
            params: { field: def.name },
          });
        }
        break;
    }
  }

  for (const key of Object.keys(fields)) {
    if (schema.fields.some((def) => def.name === key)) continue;
    // Inline literals live next to the value port they fill, e.g. `text`.
    const inlinePort = schema.ports.find((port) => port.name === key && port.kind === "value");
    if (inlinePort) {
      checkInlineLiteral(key, fields[key], inlinePort.type ?? "any", node, path, diagnostics);
      continue;
    }
    diagnostics.push({
      severity: "warning",
      code: "block.unknownField",
      message: `Unknown field "${key}" on ${node.type}`,
      path: `${path}.fields.${key}`,
      blockId: node.id,
      params: { field: key, type: node.type },
    });
  }
}

function checkInlineLiteral(
  name: string,
  value: unknown,
  type: ValueType,
  node: BlockNode,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const fieldPath = `${path}.fields.${name}`;
  if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    diagnostics.push({
      severity: "error",
      code: "block.invalidNumber",
      message: `Field "${name}" must be a finite number`,
      path: fieldPath,
      blockId: node.id,
      params: { field: name },
    });
  }
  if (type === "boolean" && typeof value !== "boolean") {
    diagnostics.push({
      severity: "error",
      code: "block.invalidOption",
      message: `Field "${name}" must be a boolean`,
      path: fieldPath,
      blockId: node.id,
      params: { field: name, value: String(value) },
    });
  }
  if (type === "text" && typeof value !== "string") {
    diagnostics.push({
      severity: "warning",
      code: "block.kindMismatch",
      message: `Field "${name}" should be text`,
      path: fieldPath,
      blockId: node.id,
      params: { field: name },
    });
  }
}

function checkInputs(
  node: BlockNode,
  schema: BlockSchema,
  schemas: SchemaSource,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const inputs = node.inputs ?? {};
  for (const [portName, value] of Object.entries(inputs)) {
    const port = schema.ports.find((candidate) => candidate.name === portName);
    const portPath = `${path}.${portName}`;
    if (!port) {
      diagnostics.push({
        severity: "warning",
        code: "port.unknown",
        message: `Unknown port "${portName}" on ${node.type}`,
        path: portPath,
        blockId: node.id,
        params: { port: portName, type: node.type },
      });
      continue;
    }
    if (port.kind === "stack") {
      if (!Array.isArray(value)) {
        diagnostics.push({
          severity: "error",
          code: "port.expectedStack",
          message: `Port "${portName}" expects a stack of blocks`,
          path: portPath,
          blockId: node.id,
          params: { port: portName },
        });
        continue;
      }
      for (const child of value) {
        const childSchema = schemas.get(child.type);
        if (childSchema && childSchema.kind === "hat") {
          diagnostics.push({
            severity: "error",
            code: "port.expectedStack",
            message: `Hat block ${child.type} cannot be placed inside a stack`,
            path: portPath,
            blockId: child.id,
            params: { type: child.type },
          });
        }
      }
    } else {
      if (Array.isArray(value)) {
        diagnostics.push({
          severity: "error",
          code: "port.expectedValue",
          message: `Port "${portName}" expects a single expression block`,
          path: portPath,
          blockId: node.id,
          params: { port: portName },
        });
        continue;
      }
      const childSchema = schemas.get(value.type);
      if (!childSchema) continue; // reported by the child visit
      if (childSchema.kind !== "expression") {
        diagnostics.push({
          severity: "error",
          code: "port.typeMismatch",
          message: `Only expression blocks can fill port "${portName}"`,
          path: portPath,
          blockId: value.id,
          params: { port: portName, type: value.type },
        });
        continue;
      }
      if (port.type) {
        checkAssignable(childSchema.output, port.type, value, portName, portPath, diagnostics);
      }
    }
  }
}

function checkAssignable(
  from: ValueType,
  to: ValueType,
  node: BlockNode,
  port: string,
  path: string,
  diagnostics: Diagnostic[],
): void {
  if (isAssignable(from, to)) return;
  diagnostics.push({
    severity: "warning",
    code: "port.typeMismatch",
    message: `Cannot pass ${from} into a ${to} port`,
    path,
    blockId: node.id,
    params: { port, from, to },
  });
}

/** Convenience: only errors. */
export function errorsOnly(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
