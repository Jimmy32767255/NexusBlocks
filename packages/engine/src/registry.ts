import type { BlockDefinition } from "./types.ts";
import { controlBlocks } from "./blocks/control.ts";
import { ioBlocks } from "./blocks/io.ts";
import { logicBlocks } from "./blocks/logic.ts";
import { mathBlocks } from "./blocks/math.ts";
import { textBlocks } from "./blocks/text.ts";
import { variableBlocks } from "./blocks/variables.ts";

/** Toolbox order. Unknown categories fall to the end. */
export const CATEGORY_ORDER: readonly string[] = [
  "control",
  "io",
  "text",
  "math",
  "logic",
  "variables",
];

export class BlockRegistry {
  private readonly definitions = new Map<string, BlockDefinition>();

  constructor(definitions: readonly BlockDefinition[]) {
    for (const definition of definitions) {
      if (this.definitions.has(definition.type)) {
        throw new Error(`Duplicate block type: ${definition.type}`);
      }
      assertDefinition(definition);
      this.definitions.set(definition.type, definition);
    }
  }

  get(type: string): BlockDefinition | undefined {
    return this.definitions.get(type);
  }

  has(type: string): boolean {
    return this.definitions.has(type);
  }

  all(): BlockDefinition[] {
    return [...this.definitions.values()].sort(compareDefinitions);
  }

  /** Blocks grouped for the toolbox, empty categories omitted. */
  grouped(): { category: string; blocks: BlockDefinition[] }[] {
    const groups = new Map<string, BlockDefinition[]>();
    for (const definition of this.all()) {
      const bucket = groups.get(definition.category);
      if (bucket) bucket.push(definition);
      else groups.set(definition.category, [definition]);
    }
    return [...groups.entries()].map(([category, blocks]) => ({ category, blocks }));
  }
}

function compareDefinitions(a: BlockDefinition, b: BlockDefinition): number {
  const ai = CATEGORY_ORDER.indexOf(a.category);
  const bi = CATEGORY_ORDER.indexOf(b.category);
  const aIndex = ai === -1 ? CATEGORY_ORDER.length : ai;
  const bIndex = bi === -1 ? CATEGORY_ORDER.length : bi;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return a.type.localeCompare(b.type);
}

function assertDefinition(definition: BlockDefinition): void {
  const { type, kind } = definition;
  if (kind === "expression" && typeof definition.evaluate !== "function") {
    throw new Error(`Expression block ${type} needs an evaluate() handler`);
  }
  if (kind !== "expression" && typeof definition.execute !== "function") {
    throw new Error(`Block ${type} needs an execute() handler`);
  }
  const ports = new Set<string>();
  for (const port of definition.ports) {
    if (ports.has(port.name)) throw new Error(`Duplicate port ${port.name} on ${type}`);
    ports.add(port.name);
  }
  const fields = new Set<string>();
  for (const field of definition.fields) {
    if (fields.has(field.name)) throw new Error(`Duplicate field ${field.name} on ${type}`);
    fields.add(field.name);
  }
}

export const coreBlocks: readonly BlockDefinition[] = [
  ...controlBlocks,
  ...ioBlocks,
  ...textBlocks,
  ...mathBlocks,
  ...logicBlocks,
  ...variableBlocks,
];

export const defaultRegistry = new BlockRegistry(coreBlocks);
