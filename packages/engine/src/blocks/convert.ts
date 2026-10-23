import { toDisplayText } from "@nexus/ir";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const CONVERT = CATEGORY_COLORS.convert;

/** Full-string decimal numbers only: optional sign, digits, fraction, exponent. */
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

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
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      const value = String(raw).trim();
      if (!NUMBER_PATTERN.test(value)) {
        ctx.fail("runtime.error.toNumber", { value });
      }
      return Number(value);
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
