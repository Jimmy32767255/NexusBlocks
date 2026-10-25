import type { Value } from "@nexus/ir";
import type { BlockDefinition, ExecutionContext } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const DATA = CATEGORY_COLORS.data;

/** Parse the JSON text stored on a literal block, with a translatable error. */
export function parseJsonLiteral(
  ctx: ExecutionContext,
  raw: Value,
  expect: "array" | "object",
): Value {
  if (typeof raw !== "string") {
    ctx.fail("runtime.error.badJson", { value: String(raw) });
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (expect === "array" && !Array.isArray(parsed)) {
      ctx.fail("runtime.error.badJson", { value: raw });
    }
    if (
      expect === "object" &&
      (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    ) {
      ctx.fail("runtime.error.badJson", { value: raw });
    }
    return parsed as Value;
  } catch {
    ctx.fail("runtime.error.badJson", { value: raw });
  }
}

export function asList(ctx: ExecutionContext, value: Value): Value[] {
  if (!Array.isArray(value)) {
    ctx.fail("runtime.error.badType", { from: typeof value, to: "list" });
  }
  return value;
}

function asIndex(ctx: ExecutionContext, value: Value, length: number): number {
  const index = Math.trunc(Number(value) || 0);
  if (index < 0 || index >= length) {
    ctx.fail("runtime.error.badIndex", { index, length });
  }
  return index;
}

export const listBlocks: BlockDefinition[] = [
  {
    type: "list.literal",
    kind: "expression",
    category: "data",
    label: "block.list.literal.label",
    description: "block.list.literal.description",
    output: "list",
    color: DATA,
    fields: [
      { name: "items", kind: "text", label: "block.list.literal.field.items", default: "[]" },
    ],
    ports: [],
    evaluate(ctx, node) {
      return parseJsonLiteral(ctx, ctx.literal(node, "items"), "array");
    },
  },
  {
    type: "list.length",
    kind: "expression",
    category: "data",
    label: "block.list.length.label",
    description: "block.list.length.description",
    output: "number",
    color: DATA,
    fields: [],
    ports: [{ name: "items", label: "block.list.length.port.items", kind: "value", type: "list" }],
    async evaluate(ctx, node) {
      return asList(ctx, await ctx.input(node, "items")).length;
    },
  },
  {
    type: "list.get",
    kind: "expression",
    category: "data",
    label: "block.list.get.label",
    description: "block.list.get.description",
    output: "any",
    color: DATA,
    fields: [],
    ports: [
      { name: "items", label: "block.list.get.port.items", kind: "value", type: "list" },
      { name: "index", label: "block.list.get.port.index", kind: "value", type: "number", default: 0 },
    ],
    async evaluate(ctx, node) {
      const items = asList(ctx, await ctx.input(node, "items"));
      const index = asIndex(ctx, await ctx.input(node, "index"), items.length);
      return items[index] ?? null;
    },
  },
  {
    type: "list.add",
    kind: "statement",
    category: "data",
    label: "block.list.add.label",
    description: "block.list.add.description",
    output: "void",
    color: DATA,
    fields: [],
    ports: [
      { name: "items", label: "block.list.add.port.items", kind: "value", type: "list" },
      { name: "value", label: "block.list.add.port.value", kind: "value", type: "any", default: "" },
    ],
    async execute(ctx, node) {
      const items = asList(ctx, await ctx.input(node, "items"));
      items.push(await ctx.input(node, "value"));
    },
  },
  {
    type: "list.set",
    kind: "statement",
    category: "data",
    label: "block.list.set.label",
    description: "block.list.set.description",
    output: "void",
    color: DATA,
    fields: [],
    ports: [
      { name: "items", label: "block.list.set.port.items", kind: "value", type: "list" },
      { name: "index", label: "block.list.set.port.index", kind: "value", type: "number", default: 0 },
      { name: "value", label: "block.list.set.port.value", kind: "value", type: "any", default: "" },
    ],
    async execute(ctx, node) {
      const items = asList(ctx, await ctx.input(node, "items"));
      const index = asIndex(ctx, await ctx.input(node, "index"), items.length);
      items[index] = await ctx.input(node, "value");
    },
  },
  {
    type: "list.remove",
    kind: "statement",
    category: "data",
    label: "block.list.remove.label",
    description: "block.list.remove.description",
    output: "void",
    color: DATA,
    fields: [],
    ports: [
      { name: "items", label: "block.list.remove.port.items", kind: "value", type: "list" },
      { name: "index", label: "block.list.remove.port.index", kind: "value", type: "number", default: 0 },
    ],
    async execute(ctx, node) {
      const items = asList(ctx, await ctx.input(node, "items"));
      const index = asIndex(ctx, await ctx.input(node, "index"), items.length);
      items.splice(index, 1);
    },
  },
];
