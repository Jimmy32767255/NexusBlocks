import { toDisplayText } from "@nexus/ir";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const TEXT = CATEGORY_COLORS.text;

export const textBlocks: BlockDefinition[] = [
  {
    type: "text.literal",
    kind: "expression",
    category: "text",
    label: "block.text.literal.label",
    description: "block.text.literal.description",
    output: "text",
    color: TEXT,
    fields: [{ name: "value", kind: "text", label: "block.text.literal.field.value", default: "" }],
    ports: [],
    evaluate(_ctx, node) {
      const value = node.fields?.value;
      return typeof value === "string" ? value : String(value ?? "");
    },
  },
  {
    type: "text.join",
    kind: "expression",
    category: "text",
    label: "block.text.join.label",
    description: "block.text.join.description",
    output: "text",
    color: TEXT,
    fields: [],
    ports: [
      { name: "a", label: "block.text.join.port.a", kind: "value", type: "text", default: "" },
      { name: "b", label: "block.text.join.port.b", kind: "value", type: "text", default: "" },
    ],
    async evaluate(ctx, node) {
      const a = await ctx.input(node, "a");
      const b = await ctx.input(node, "b");
      return `${toDisplayText(a)}${toDisplayText(b)}`;
    },
  },
];
