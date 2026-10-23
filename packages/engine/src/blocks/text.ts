import { countField, toDisplayText, type BlockNode, type FieldDef, type PortDef } from "@nexus/ir";
import { RuntimeFailure } from "../errors.ts";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const TEXT = CATEGORY_COLORS.text;

const JOIN_COUNT: FieldDef = {
  name: "count",
  kind: "count",
  label: "block.text.join.field.count",
  default: 2,
  min: 2,
  max: 8,
};

function joinPorts(node: BlockNode): PortDef[] {
  const count = countField(node, JOIN_COUNT);
  return Array.from({ length: count }, (_, index) => ({
    name: String.fromCharCode(97 + index),
    label: index < 2 ? `block.text.join.port.${index === 0 ? "a" : "b"}` : "block.text.join.port.item",
    kind: "value" as const,
    type: "text" as const,
    default: "",
  }));
}

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
    fields: [JOIN_COUNT],
    ports: [],
    dynamicPorts: joinPorts,
    async evaluate(ctx, node) {
      let result = "";
      for (const port of joinPorts(node)) {
        result += toDisplayText(await ctx.input(node, port.name));
      }
      return result;
    },
  },
  {
    type: "text.splitAt",
    kind: "expression",
    category: "text",
    label: "block.text.splitAt.label",
    description: "block.text.splitAt.description",
    output: "text",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.splitAt.port.text", kind: "value", type: "text", default: "" },
      { name: "separator", label: "block.text.splitAt.port.separator", kind: "value", type: "text", default: "," },
      { name: "index", label: "block.text.splitAt.port.index", kind: "value", type: "number", default: 1 },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const separator = toDisplayText(await ctx.input(node, "separator"));
      const index = Math.floor(Number(await ctx.input(node, "index")) || 0);
      if (separator === "") throw new RuntimeFailure("runtime.error.splitSeparator");
      const parts = text.split(separator);
      if (index < 1 || index > parts.length) {
        throw new RuntimeFailure("runtime.error.splitIndex", { index, length: parts.length });
      }
      return parts[index - 1] ?? "";
    },
  },
  {
    type: "text.contains",
    kind: "expression",
    category: "text",
    label: "block.text.contains.label",
    description: "block.text.contains.description",
    output: "boolean",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.contains.port.text", kind: "value", type: "text", default: "" },
      { name: "needle", label: "block.text.contains.port.needle", kind: "value", type: "text", default: "" },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const needle = toDisplayText(await ctx.input(node, "needle"));
      return text.includes(needle);
    },
  },
];
