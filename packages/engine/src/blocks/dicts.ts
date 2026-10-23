import type { Value } from "@nexus/ir";
import type { BlockDefinition, ExecutionContext } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";
import { parseJsonLiteral } from "./lists.ts";

const DATA = CATEGORY_COLORS.data;

export function asDict(ctx: ExecutionContext, value: Value): { [key: string]: Value } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    ctx.fail("runtime.error.badType", { from: typeof value, to: "dict" });
  }
  return value as { [key: string]: Value };
}

function keyOf(value: Value): string {
  return typeof value === "string" ? value : String(value);
}

export const dictBlocks: BlockDefinition[] = [
  {
    type: "dict.literal",
    kind: "expression",
    category: "data",
    label: "block.dict.literal.label",
    description: "block.dict.literal.description",
    output: "dict",
    color: DATA,
    fields: [
      { name: "items", kind: "text", label: "block.dict.literal.field.items", default: "{}" },
    ],
    ports: [],
    evaluate(ctx, node) {
      return parseJsonLiteral(ctx, ctx.literal(node, "items"), "object");
    },
  },
  {
    type: "dict.get",
    kind: "expression",
    category: "data",
    label: "block.dict.get.label",
    description: "block.dict.get.description",
    output: "any",
    color: DATA,
    fields: [],
    ports: [
      { name: "dict", label: "block.dict.get.port.dict", kind: "value", type: "dict" },
      { name: "key", label: "block.dict.get.port.key", kind: "value", type: "text", default: "" },
    ],
    async evaluate(ctx, node) {
      const dict = asDict(ctx, await ctx.input(node, "dict"));
      const key = keyOf(await ctx.input(node, "key"));
      return dict[key] ?? null;
    },
  },
  {
    type: "dict.has",
    kind: "expression",
    category: "data",
    label: "block.dict.has.label",
    description: "block.dict.has.description",
    output: "boolean",
    color: DATA,
    fields: [],
    ports: [
      { name: "dict", label: "block.dict.has.port.dict", kind: "value", type: "dict" },
      { name: "key", label: "block.dict.has.port.key", kind: "value", type: "text", default: "" },
    ],
    async evaluate(ctx, node) {
      const dict = asDict(ctx, await ctx.input(node, "dict"));
      return keyOf(await ctx.input(node, "key")) in dict;
    },
  },
  {
    type: "dict.keys",
    kind: "expression",
    category: "data",
    label: "block.dict.keys.label",
    description: "block.dict.keys.description",
    output: "list",
    color: DATA,
    fields: [],
    ports: [{ name: "dict", label: "block.dict.keys.port.dict", kind: "value", type: "dict" }],
    async evaluate(ctx, node) {
      return Object.keys(asDict(ctx, await ctx.input(node, "dict")));
    },
  },
  {
    type: "dict.set",
    kind: "statement",
    category: "data",
    label: "block.dict.set.label",
    description: "block.dict.set.description",
    output: "void",
    color: DATA,
    fields: [],
    ports: [
      { name: "dict", label: "block.dict.set.port.dict", kind: "value", type: "dict" },
      { name: "key", label: "block.dict.set.port.key", kind: "value", type: "text", default: "" },
      { name: "value", label: "block.dict.set.port.value", kind: "value", type: "any", default: "" },
    ],
    async execute(ctx, node) {
      const dict = asDict(ctx, await ctx.input(node, "dict"));
      dict[keyOf(await ctx.input(node, "key"))] = await ctx.input(node, "value");
    },
  },
];
