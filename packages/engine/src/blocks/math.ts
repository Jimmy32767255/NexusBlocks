import { countField, type PortDef } from "@nexus/ir";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const MATH = CATEGORY_COLORS.math;

export const mathBlocks: BlockDefinition[] = [
  {
    type: "math.number",
    kind: "expression",
    category: "math",
    label: "block.math.number.label",
    description: "block.math.number.description",
    output: "number",
    color: MATH,
    fields: [{ name: "value", kind: "number", label: "block.math.number.field.value", default: 0 }],
    ports: [],
    evaluate(ctx, node) {
      const raw = node.fields?.value ?? 0;
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        ctx.fail("runtime.error.badNumber", { value: String(raw) });
      }
      return value;
    },
  },
  {
    type: "math.arithmetic",
    kind: "expression",
    category: "math",
    label: "block.math.arithmetic.label",
    description: "block.math.arithmetic.description",
    output: "number",
    color: MATH,
    fields: [
      {
        name: "op",
        kind: "select",
        label: "block.math.arithmetic.field.op",
        default: "+",
        options: [
          { value: "+", label: "+" },
          { value: "-", label: "−" },
          { value: "*", label: "×" },
          { value: "/", label: "÷" },
          { value: "%", label: "%" },
        ],
      },
      {
        name: "count",
        kind: "count",
        label: "block.math.arithmetic.field.count",
        default: 2,
        min: 2,
      },
    ],
    ports: [
      { name: "a", label: "block.math.arithmetic.port.a", kind: "value", type: "number", default: 0 },
      { name: "b", label: "block.math.arithmetic.port.b", kind: "value", type: "number", default: 0 },
    ],
    dynamicPorts(node): PortDef[] {
      const count = Math.max(2, countField(node, { name: "count", kind: "count", label: "", default: 2 }));
      const ports: PortDef[] = [];
      for (let index = 1; index <= count; index += 1) {
        ports.push({
          name: index === 1 ? "a" : index === 2 ? "b" : `n${index}`,
          label: "block.math.arithmetic.port.item",
          kind: "value",
          type: "number",
          default: 0,
        });
      }
      return ports;
    },
    async evaluate(ctx, node) {
      const count = Math.max(2, countField(node, { name: "count", kind: "count", label: "", default: 2 }));
      const op = String(node.fields?.op ?? "+");
      let total = Number(await ctx.input(node, "a"));
      for (let index = 2; index <= count; index += 1) {
        const value = Number(await ctx.input(node, index === 2 ? "b" : `n${index}`));
        switch (op) {
          case "+":
            total += value;
            break;
          case "-":
            total -= value;
            break;
          case "*":
            total *= value;
            break;
          case "/":
            if (value === 0) ctx.fail("runtime.error.divisionByZero");
            total /= value;
            break;
          case "%":
            if (value === 0) ctx.fail("runtime.error.divisionByZero");
            total %= value;
            break;
          default:
            return ctx.fail("runtime.error.unknownBlock", { type: `math.arithmetic(${op})` });
        }
      }
      return total;
    },
  },
  {
    type: "math.round",
    kind: "expression",
    category: "math",
    label: "block.math.round.label",
    description: "block.math.round.description",
    output: "number",
    color: MATH,
    fields: [
      {
        name: "mode",
        kind: "select",
        label: "block.math.round.field.mode",
        default: "round",
        options: [
          { value: "ceil", label: "⌈⌉" },
          { value: "floor", label: "⌊⌋" },
          { value: "round", label: "≈" },
        ],
      },
    ],
    ports: [{ name: "value", label: "block.math.round.port.value", kind: "value", type: "number", default: 0 }],
    async evaluate(ctx, node) {
      const value = Number(await ctx.input(node, "value"));
      const mode = String(node.fields?.mode ?? "round");
      if (mode === "ceil") return Math.ceil(value);
      if (mode === "floor") return Math.floor(value);
      return Math.round(value);
    },
  },
  {
    type: "math.abs",
    kind: "expression",
    category: "math",
    label: "block.math.abs.label",
    description: "block.math.abs.description",
    output: "number",
    color: MATH,
    fields: [],
    ports: [{ name: "value", label: "block.math.abs.port.value", kind: "value", type: "number", default: 0 }],
    async evaluate(ctx, node) {
      return Math.abs(Number(await ctx.input(node, "value")));
    },
  },
];
