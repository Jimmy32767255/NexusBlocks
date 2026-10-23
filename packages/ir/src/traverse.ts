import { createId } from "./ids.ts";
import type { BlockNode, Project } from "./model.ts";

export interface BlockWalkContext {
  /** Stack the block currently sits in; top-level scripts are their own stack. */
  stack: BlockNode[];
  index: number;
  /** Enclosing block, or `null` for top-level scripts. */
  parent: BlockNode | null;
  /** Port name that holds this block/stack (`body`, `text`, ...). */
  port: string | null;
  /** JSON-pointer-ish path, useful for diagnostics. */
  path: string;
}

export type BlockVisitor = (node: BlockNode, context: BlockWalkContext) => void;

/** Depth-first walk over a stack, including nested stacks and expressions. */
export function walkBlocks(
  blocks: BlockNode[],
  visit: BlockVisitor,
  parent: BlockNode | null = null,
  port: string | null = null,
  basePath = "scripts",
): void {
  blocks.forEach((node, index) => {
    const path = `${basePath}[${index}]`;
    visit(node, { stack: blocks, index, parent, port, path });
    walkChildren(node, visit, path);
  });
}

function walkChildren(node: BlockNode, visit: BlockVisitor, path: string): void {
  const inputs = node.inputs;
  if (!inputs) return;
  for (const [portName, value] of Object.entries(inputs)) {
    if (Array.isArray(value)) {
      walkBlocks(value, visit, node, portName, `${path}.${portName}`);
    } else {
      visit(value, {
        stack: [],
        index: 0,
        parent: node,
        port: portName,
        path: `${path}.${portName}`,
      });
      walkChildren(value, visit, `${path}.${portName}`);
    }
  }
}

/** Walk scripts and function bodies. */
export function walkProject(project: Project, visit: BlockVisitor): void {
  walkBlocks(project.scripts, visit);
  project.functions.forEach((fn, fnIndex) => {
    walkBlocks(fn.body, visit, null, null, `functions[${fnIndex}].body`);
  });
}

export function collectBlockIds(project: Project): Set<string> {
  const ids = new Set<string>();
  walkProject(project, (node) => ids.add(node.id));
  return ids;
}

export function countBlocks(project: Project): number {
  let count = 0;
  walkProject(project, () => {
    count += 1;
  });
  return count;
}

/** Deep clone a block tree, assigning fresh ids (for duplicate and paste). */
export function cloneBlock(node: BlockNode, map?: Map<string, string>): BlockNode {
  const idMap = map ?? new Map<string, string>();
  const newId = createId();
  idMap.set(node.id, newId);
  const clone: BlockNode = { id: newId, type: node.type };
  if (node.fields) clone.fields = { ...node.fields };
  if (node.inputs) {
    const inputs: Record<string, BlockNode | BlockNode[]> = {};
    for (const [port, value] of Object.entries(node.inputs)) {
      inputs[port] = Array.isArray(value)
        ? value.map((child) => cloneBlock(child, idMap))
        : cloneBlock(value, idMap);
    }
    clone.inputs = inputs;
  }
  return clone;
}

/** Find a block by id anywhere in the project. */
export function findBlock(project: Project, id: string): BlockNode | null {
  let found: BlockNode | null = null;
  walkProject(project, (node) => {
    if (!found && node.id === id) found = node;
  });
  return found;
}
