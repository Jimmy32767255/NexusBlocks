import { toDisplayText, type Value } from "@nexus/ir";
import { RuntimeFailure } from "../errors.ts";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const CONVERT = CATEGORY_COLORS.convert;

/** Full-string decimal numbers only: optional sign, digits, fraction, exponent. */
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function typeNameOf(value: Value): string {
  if (value === null || value === undefined) return "无";
  if (Array.isArray(value)) return "列表";
  switch (typeof value) {
    case "number":
      return "数字";
    case "boolean":
      return "布尔值";
    case "string":
      return "文本";
    default:
      return "字典";
  }
}

export const convertBlocks: BlockDefinition[] = [
  {
    type: "convert.toNumber",
    kind: "expression",
    category: "convert",
    label: "block.convert.toNumber.label",
    description: "block.convert.toNumber.description",
    output: "number",
    color: CONVERT,
    fields: [],
    ports: [{ name: "text", label: "block.convert.toNumber.port.text", kind: "value", type: "text", default: "0" }],
    async evaluate(ctx, node) {
      const raw = await ctx.input(node, "text");
      if (typeof raw === "boolean") return raw ? 1 : 0;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      const value = String(raw).trim();
      if (!NUMBER_PATTERN.test(value)) {
        ctx.fail("runtime.error.toNumber", { value });
      }
      return Number(value);
    },
  },
  {
    type: "convert.typeOf",
    kind: "expression",
    category: "convert",
    label: "block.convert.typeOf.label",
    description: "block.convert.typeOf.description",
    output: "text",
    color: CONVERT,
    fields: [],
    ports: [{ name: "value", label: "block.convert.typeOf.port.value", kind: "value", type: "any", default: "" }],
    async evaluate(ctx, node) {
      return typeNameOf(await ctx.input(node, "value"));
    },
  },
  {
    type: "convert.toBoolean",
    kind: "expression",
    category: "convert",
    label: "block.convert.toBoolean.label",
    description: "block.convert.toBoolean.description",
    output: "boolean",
    color: CONVERT,
    fields: [],
    ports: [{ name: "value", label: "block.convert.toBoolean.port.value", kind: "value", type: "any", default: "" }],
    async evaluate(ctx, node) {
      const raw = await ctx.input(node, "value");
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "number") return raw !== 0;
      const text = String(raw).trim().toLowerCase();
      if (text === "true") return true;
      if (text === "false") return false;
      return ctx.fail("runtime.error.toBoolean", { value: String(raw) });
    },
  },
  {
    type: "convert.parseJson",
    kind: "expression",
    category: "convert",
    label: "block.convert.parseJson.label",
    description: "block.convert.parseJson.description",
    output: "any",
    color: CONVERT,
    fields: [],
    ports: [{ name: "text", label: "block.convert.parseJson.port.text", kind: "value", type: "text", default: "" }],
    async evaluate(ctx, node) {
      const raw = toDisplayText(await ctx.input(node, "text"));
      try {
        return JSON.parse(raw) as Value;
      } catch {
        throw new RuntimeFailure("runtime.error.badJson", { value: raw });
      }
    },
  },
  {
    type: "convert.toString",
    kind: "expression",
    category: "convert",
    label: "block.convert.toString.label",
    description: "block.convert.toString.description",
    output: "text",
    color: CONVERT,
    fields: [],
    ports: [{ name: "value", label: "block.convert.toString.port.value", kind: "value", type: "any", default: "" }],
    async evaluate(ctx, node) {
      return toDisplayText(await ctx.input(node, "value"));
    },
  },
];
