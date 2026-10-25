import { toDisplayText, truthy, valuesEqual, type Value } from "@nexus/ir";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const LOGIC = CATEGORY_COLORS.logic;

function compare(op: string, a: Value, b: Value): boolean {
  switch (op) {
    case "==":
      return valuesEqual(a, b);
    case "!=":
      return !valuesEqual(a, b);
    default:
      break;
  }
  const bothNumeric =
    (typeof a === "number" || (typeof a === "string" && a.trim() !== "" && !Number.isNaN(Number(a)))) &&
    (typeof b === "number" || (typeof b === "string" && b.trim() !== "" && !Number.isNaN(Number(b))));
  if (bothNumeric) {
    const x = Number(a);
    const y = Number(b);
    switch (op) {
      case "<":
        return x < y;
      case "<=":
        return x <= y;
      case ">":
        return x > y;
      case ">=":
        return x >= y;
    }
  }
  const x = toDisplayText(a);
  const y = toDisplayText(b);
  switch (op) {
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    default:
      return false;
  }
}

export const logicBlocks: BlockDefinition[] = [
  {
    type: "logic.not",
    kind: "expression",
    category: "logic",
    label: "block.logic.not.label",
    description: "block.logic.not.description",
    output: "boolean",
    color: LOGIC,
    fields: [],
    ports: [{ name: "value", label: "block.logic.not.port.value", kind: "value", type: "boolean", default: true }],
    async evaluate(ctx, node) {
      return !truthy(await ctx.input(node, "value"));
    },
  },
  {
    type: "logic.and",
    kind: "expression",
    category: "logic",
    label: "block.logic.and.label",
    description: "block.logic.and.description",
    output: "boolean",
    color: LOGIC,
    fields: [],
    ports: [
      { name: "a", label: "block.logic.and.port.a", kind: "value", type: "boolean", default: true },
      { name: "b", label: "block.logic.and.port.b", kind: "value", type: "boolean", default: true },
    ],
    async evaluate(ctx, node) {
      if (!truthy(await ctx.input(node, "a"))) return false;
      return truthy(await ctx.input(node, "b"));
    },
  },
  {
    type: "logic.or",
    kind: "expression",
    category: "logic",
    label: "block.logic.or.label",
    description: "block.logic.or.description",
    output: "boolean",
    color: LOGIC,
    fields: [],
    ports: [
      { name: "a", label: "block.logic.or.port.a", kind: "value", type: "boolean", default: false },
      { name: "b", label: "block.logic.or.port.b", kind: "value", type: "boolean", default: false },
    ],
    async evaluate(ctx, node) {
      if (truthy(await ctx.input(node, "a"))) return true;
      return truthy(await ctx.input(node, "b"));
    },
  },
  {
    type: "logic.boolean",
    kind: "expression",
    category: "logic",
    label: "block.logic.boolean.label",
    description: "block.logic.boolean.description",
    output: "boolean",
    color: LOGIC,
    fields: [{ name: "value", kind: "boolean", label: "block.logic.boolean.field.value", default: true }],
    ports: [],
    evaluate(_ctx, node) {
      return truthy((node.fields?.value ?? false) as Value);
    },
  },
  {
    type: "logic.compare",
    kind: "expression",
    category: "logic",
    label: "block.logic.compare.label",
    description: "block.logic.compare.description",
    output: "boolean",
    color: LOGIC,
    fields: [
      {
        name: "op",
        kind: "select",
        label: "block.logic.compare.field.op",
        default: "==",
        options: [
          { value: "==", label: "=" },
          { value: "!=", label: "≠" },
          { value: "<", label: "<" },
          { value: "<=", label: "≤" },
          { value: ">", label: ">" },
          { value: ">=", label: "≥" },
        ],
      },
    ],
    ports: [
      { name: "a", label: "block.logic.compare.port.a", kind: "value", type: "any", default: "" },
      { name: "b", label: "block.logic.compare.port.b", kind: "value", type: "any", default: "" },
    ],
    async evaluate(ctx, node) {
      const a = await ctx.input(node, "a");
      const b = await ctx.input(node, "b");
      return compare(String(node.fields?.op ?? "=="), a, b);
    },
  },
];
