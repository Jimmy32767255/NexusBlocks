import {
  createBlock,
  findBlock,
  FUNCTION_DEFINE_TYPE,
  functionCallType,
  walkBlocks,
  walkProject,
  type BlockNode,
  type BlockWalkContext,
  type NexusDocument,
  type Project,
} from "@nexus/ir";
import type { BlockRegistry } from "@nexus/engine";

export type InstanceResult =
  | { ok: true; node: BlockNode }
  | { ok: false; reason: "unknown" | "variable" };

/**
 * Instantiate a block from its schema, filling declared fields with defaults.
 * Variable blocks require at least one variable to exist.
 */
export function newBlockInstance(
  registry: BlockRegistry,
  project: Project,
  type: string,
): InstanceResult {
  const definition = registry.get(type);
  if (!definition) return { ok: false, reason: "unknown" };

  const node = createBlock(type);
  if (definition.fields.length === 0) return { ok: true, node };

  const fields: Record<string, string | number | boolean> = {};
  for (const field of definition.fields) {
    let value = field.default;
    if (field.kind === "variable") {
      const variable = project.variables[0];
      if (!variable) return { ok: false, reason: "variable" };
      value = variable.id;
    }
    fields[field.name] = value;
  }
  node.fields = fields;
  return { ok: true, node };
}

export function insertIntoStack(
  project: Project,
  parentId: string,
  port: string,
  index: number,
  node: BlockNode,
): boolean {
  const parent = findBlock(project, parentId);
  if (!parent) return false;
  const inputs = (parent.inputs ??= {});
  const existing = inputs[port];
  if (existing !== undefined && !Array.isArray(existing)) return false;
  const stack = Array.isArray(existing) ? existing : [];
  if (!Array.isArray(existing)) inputs[port] = stack;
  stack.splice(Math.max(0, Math.min(index, stack.length)), 0, node);
  return true;
}

export function plugIntoPort(
  project: Project,
  parentId: string,
  port: string,
  node: BlockNode,
): boolean {
  const parent = findBlock(project, parentId);
  if (!parent) return false;
  const inputs = (parent.inputs ??= {});
  if (inputs[port] !== undefined) return false;
  inputs[port] = node;
  return true;
}

export function unplugPort(project: Project, parentId: string, port: string): BlockNode | null {
  const parent = findBlock(project, parentId);
  const child = parent?.inputs?.[port];
  if (!parent || !child || Array.isArray(child)) return null;
  delete parent.inputs![port];
  return child;
}

export interface BlockLocation {
  stack: BlockNode[];
  index: number;
  parent: BlockNode | null;
  port: string | null;
}

/** Stack and index a block occupies. Top-level scripts are their own stack. */
export function locateBlock(project: Project, id: string): BlockLocation | null {
  let found: BlockLocation | null = null;
  const visit = (node: BlockNode, context: BlockWalkContext): void => {
    if (found || node.id !== id) return;
    found = { stack: context.stack, index: context.index, parent: context.parent, port: context.port };
  };
  walkBlocks(project.scripts, visit);
  project.functions.forEach((fn) => walkBlocks(fn.body, visit, null, null, "functions"));
  return found;
}

export function removeBlock(document: NexusDocument, id: string): boolean {
  const { project } = document;
  const target = findBlock(project, id);
  const callType = target?.type === FUNCTION_DEFINE_TYPE ? functionCallType(target.id) : null;
  let removed = removeFromStack(project.scripts, id);
  if (!removed) {
    for (const fn of project.functions) {
      if (removeFromStack(fn.body, id)) {
        removed = true;
        break;
      }
    }
  }
  if (removed) {
    // Deleting a definition must not leave dangling calls behind.
    if (callType) removeCalls(project, callType);
  }
  return removed;
}

function removeCalls(project: Project, type: string): void {
  walkProject(project, (node) => {
    const inputs = node.inputs;
    if (!inputs) return;
    for (const [port, value] of Object.entries(inputs)) {
      if (Array.isArray(value)) {
        const kept = value.filter((child) => child.type !== type);
        if (kept.length === 0) delete inputs[port];
        else inputs[port] = kept;
      } else if (value.type === type) {
        delete inputs[port];
      }
    }
  });
}

function removeFromStack(stack: BlockNode[], id: string): boolean {
  const index = stack.findIndex((node) => node.id === id);
  if (index >= 0) {
    stack.splice(index, 1);
    return true;
  }
  for (const node of stack) {
    if (removeFromInputs(node, id)) return true;
  }
  return false;
}

function removeFromInputs(node: BlockNode, id: string): boolean {
  const inputs = node.inputs;
  if (!inputs) return false;
  for (const [port, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      if (removeFromStack(value, id)) return true;
    } else if (value.id === id) {
      delete inputs[port];
      return true;
    } else if (removeFromInputs(value, id)) {
      return true;
    }
  }
  return false;
}

/** Move a top-level script one slot up or down; false when it is already at the edge. */
export function moveScript(project: Project, id: string, delta: -1 | 1): boolean {
  const scripts = project.scripts;
  const index = scripts.findIndex((node) => node.id === id);
  if (index < 0) return false;
  const target = index + delta;
  if (target < 0 || target >= scripts.length) return false;
  const [node] = scripts.splice(index, 1);
  if (!node) return false;
  scripts.splice(target, 0, node);
  return true;
}

/** Append a statement to the last script's body (toolbox click shortcut). */
export function appendToScript(project: Project, node: BlockNode): boolean {
  const script = project.scripts[project.scripts.length - 1];
  if (!script) return false;
  const inputs = (script.inputs ??= {});
  const existing = inputs.body;
  const stack = Array.isArray(existing) ? existing : [];
  if (!Array.isArray(existing)) inputs.body = stack;
  stack.push(node);
  return true;
}

/**
 * Create a new top-level script headed by “when program starts”. When `node`
 * is given it becomes the first statement of the script body.
 */
export function createScriptWith(document: NexusDocument, node: BlockNode | null): BlockNode {
  const hat = createBlock("control.start");
  if (node) hat.inputs = { body: [node] };
  document.project.scripts.push(hat);
  return hat;
}
