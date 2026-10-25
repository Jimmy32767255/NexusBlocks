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
      { name: "index", label: "block.text.splitAt.port.index", kind: "value", type: "number", default: 0 },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const separator = toDisplayText(await ctx.input(node, "separator"));
      const index = Math.floor(Number(await ctx.input(node, "index")) || 0);
      if (separator === "") throw new RuntimeFailure("runtime.error.splitSeparator");
      const parts = text.split(separator);
      if (index < 0 || index >= parts.length) {
        throw new RuntimeFailure("runtime.error.splitIndex", { index, length: parts.length });
      }
      return parts[index] ?? "";
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
  {
    type: "text.length",
    kind: "expression",
    category: "text",
    label: "block.text.length.label",
    description: "block.text.length.description",
    output: "number",
    color: TEXT,
    fields: [],
    ports: [{ name: "text", label: "block.text.length.port.text", kind: "value", type: "text", default: "" }],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      return codePoints(text).length;
    },
  },
  {
    type: "text.charAt",
    kind: "expression",
    category: "text",
    label: "block.text.charAt.label",
    description: "block.text.charAt.description",
    output: "text",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.charAt.port.text", kind: "value", type: "text", default: "" },
      { name: "index", label: "block.text.charAt.port.index", kind: "value", type: "number", default: 0 },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const chars = codePoints(text);
      const index = Math.floor(Number(await ctx.input(node, "index")) || 0);
      if (index < 0 || index >= chars.length) {
        throw new RuntimeFailure("runtime.error.textIndex", { index, length: chars.length });
      }
      return chars[index] ?? "";
    },
  },
  {
    type: "text.slice",
    kind: "expression",
    category: "text",
    label: "block.text.slice.label",
    description: "block.text.slice.description",
    output: "text",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.slice.port.text", kind: "value", type: "text", default: "" },
      { name: "start", label: "block.text.slice.port.start", kind: "value", type: "number", default: 0 },
      { name: "length", label: "block.text.slice.port.length", kind: "value", type: "number", default: 1 },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const chars = codePoints(text);
      const start = Math.floor(Number(await ctx.input(node, "start")) || 0);
      const count = Math.floor(Number(await ctx.input(node, "length")) || 0);
      if (start < 0 || start > chars.length) {
        throw new RuntimeFailure("runtime.error.textIndex", { index: start, length: chars.length });
      }
      if (count <= 0 || start === chars.length) return "";
      return chars.slice(start, start + count).join("");
    },
  },
  {
    type: "text.indexOf",
    kind: "expression",
    category: "text",
    label: "block.text.indexOf.label",
    description: "block.text.indexOf.description",
    output: "number",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.indexOf.port.text", kind: "value", type: "text", default: "" },
      { name: "needle", label: "block.text.indexOf.port.needle", kind: "value", type: "text", default: "" },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const needle = toDisplayText(await ctx.input(node, "needle"));
      const unitIndex = text.indexOf(needle);
      if (unitIndex < 0) return -1;
      return codePoints(text.slice(0, unitIndex)).length;
    },
  },
  {
    type: "text.split",
    kind: "expression",
    category: "text",
    label: "block.text.split.label",
    description: "block.text.split.description",
    output: "list",
    color: TEXT,
    fields: [],
    ports: [
      { name: "text", label: "block.text.split.port.text", kind: "value", type: "text", default: "" },
      { name: "separator", label: "block.text.split.port.separator", kind: "value", type: "text", default: "," },
    ],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      const separator = toDisplayText(await ctx.input(node, "separator"));
      if (separator === "") throw new RuntimeFailure("runtime.error.splitSeparator");
      return text.split(separator);
    },
  },
  {
    type: "text.codePoint",
    kind: "expression",
    category: "text",
    label: "block.text.codePoint.label",
    description: "block.text.codePoint.description",
    output: "number",
    color: TEXT,
    fields: [],
    ports: [{ name: "text", label: "block.text.codePoint.port.text", kind: "value", type: "text", default: "" }],
    async evaluate(ctx, node) {
      const text = toDisplayText(await ctx.input(node, "text"));
      if (text === "") throw new RuntimeFailure("runtime.error.emptyText");
      return text.codePointAt(0) ?? 0;
    },
  },
  {
    type: "text.fromCodePoint",
    kind: "expression",
    category: "text",
    label: "block.text.fromCodePoint.label",
    description: "block.text.fromCodePoint.description",
    output: "text",
    color: TEXT,
    fields: [],
    ports: [{ name: "code", label: "block.text.fromCodePoint.port.code", kind: "value", type: "number", default: 65 }],
    async evaluate(ctx, node) {
      const code = Number(await ctx.input(node, "code"));
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) {
        throw new RuntimeFailure("runtime.error.badCodePoint", { value: String(code) });
      }
      return String.fromCodePoint(code);
    },
  },
];

/** Split by Unicode code point, so emoji and CJK count as one character. */
function codePoints(text: string): string[] {
  return Array.from(text);
}
