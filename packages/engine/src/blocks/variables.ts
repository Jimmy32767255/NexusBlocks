import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const VARIABLES = CATEGORY_COLORS.variables;

export const variableBlocks: BlockDefinition[] = [
  {
    type: "var.set",
    kind: "statement",
    category: "variables",
    label: "block.var.set.label",
    description: "block.var.set.description",
    output: "void",
    color: VARIABLES,
    fields: [
      {
        name: "variable",
        kind: "variable",
        label: "block.var.set.field.variable",
        default: "",
        required: true,
      },
    ],
    ports: [{ name: "value", label: "block.var.set.port.value", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      const variableId = String(node.fields?.variable ?? "");
      if (!variableId) ctx.fail("runtime.error.missingVariable", { name: "" });
      const value = await ctx.input(node, "value");
      ctx.setVariable(variableId, value);
    },
  },
  {
    type: "var.get",
    kind: "expression",
    category: "variables",
    label: "block.var.get.label",
    description: "block.var.get.description",
    output: "any",
    color: VARIABLES,
    fields: [
      {
        name: "variable",
        kind: "variable",
        label: "block.var.get.field.variable",
        default: "",
        required: true,
      },
    ],
    ports: [],
    evaluate(ctx, node) {
      const variableId = String(node.fields?.variable ?? "");
      if (!variableId) ctx.fail("runtime.error.missingVariable", { name: "" });
      return ctx.getVariable(variableId);
    },
  },
];
