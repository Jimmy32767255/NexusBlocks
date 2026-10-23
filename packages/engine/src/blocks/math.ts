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
    ],
    ports: [
      { name: "a", label: "block.math.arithmetic.port.a", kind: "value", type: "number", default: 0 },
      { name: "b", label: "block.math.arithmetic.port.b", kind: "value", type: "number", default: 0 },
    ],
    async evaluate(ctx, node) {
      const a = Number(await ctx.input(node, "a"));
      const b = Number(await ctx.input(node, "b"));
      const op = String(node.fields?.op ?? "+");
      switch (op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          if (b === 0) ctx.fail("runtime.error.divisionByZero");
          return a / b;
        case "%":
          if (b === 0) ctx.fail("runtime.error.divisionByZero");
          return a % b;
        default:
          return ctx.fail("runtime.error.unknownBlock", { type: `math.arithmetic(${op})` });
      }
    },
  },
];
