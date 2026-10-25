import type { ValueType } from "@nexus/ir";
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
      const name = String(node.fields?.variable ?? "").trim();
      if (!name) ctx.fail("runtime.error.missingVariable", { name: "" });
      const value = await ctx.input(node, "value");
      ctx.setVariable(name, value);
    },
  },
  {
    type: "var.create",
    kind: "statement",
    category: "variables",
    label: "block.var.create.label",
    description: "block.var.create.description",
    output: "void",
    color: VARIABLES,
    fields: [
      { name: "name", kind: "text", label: "block.var.create.field.name", default: "", required: true },
      {
        name: "type",
        kind: "select",
        label: "block.var.create.field.type",
        default: "any",
        options: ["any", "text", "number", "boolean", "list", "dict"].map((value) => ({ value, label: value })),
      },
    ],
    ports: [{ name: "value", label: "block.var.create.port.value", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      const name = String(node.fields?.name ?? "").trim();
      if (!name) ctx.fail("runtime.error.invalidVariableName", { name: "" });
      const type = String(node.fields?.type ?? "any") as ValueType;
      const value = ctx.coerce(await ctx.input(node, "value"), type, node.id);
      ctx.createVariable(name, value);
    },
  },
  {
    type: "var.createLocal",
    kind: "statement",
    category: "variables",
    label: "block.var.createLocal.label",
    description: "block.var.createLocal.description",
    output: "void",
    color: VARIABLES,
    fields: [
      { name: "name", kind: "text", label: "block.var.createLocal.field.name", default: "", required: true },
      {
        name: "type",
        kind: "select",
        label: "block.var.createLocal.field.type",
        default: "any",
        options: ["any", "text", "number", "boolean", "list", "dict"].map((value) => ({ value, label: value })),
      },
    ],
    ports: [{ name: "value", label: "block.var.createLocal.port.value", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      const name = String(node.fields?.name ?? "").trim();
      if (!name) ctx.fail("runtime.error.invalidVariableName", { name: "" });
      const type = String(node.fields?.type ?? "any") as ValueType;
      const value = ctx.coerce(await ctx.input(node, "value"), type, node.id);
      ctx.createLocalVariable(name, value);
    },
  },
  {
    type: "var.setLocal",
    kind: "statement",
    category: "variables",
    label: "block.var.setLocal.label",
    description: "block.var.setLocal.description",
    output: "void",
    color: VARIABLES,
    fields: [
      {
        name: "variable",
        kind: "variable",
        label: "block.var.setLocal.field.variable",
        default: "",
        required: true,
      },
    ],
    ports: [{ name: "value", label: "block.var.setLocal.port.value", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      const name = String(node.fields?.variable ?? "").trim();
      if (!name) ctx.fail("runtime.error.missingVariable", { name: "" });
      const value = await ctx.input(node, "value");
      ctx.setLocalVariable(name, value);
    },
  },
  {
    type: "var.delete",
    kind: "statement",
    category: "variables",
    label: "block.var.delete.label",
    description: "block.var.delete.description",
    output: "void",
    color: VARIABLES,
    fields: [{ name: "name", kind: "text", label: "block.var.delete.field.name", default: "", required: true }],
    ports: [],
    execute(ctx, node) {
      const name = String(node.fields?.name ?? "").trim();
      if (!name) ctx.fail("runtime.error.invalidVariableName", { name: "" });
      ctx.deleteVariable(name);
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
      const name = String(node.fields?.variable ?? "").trim();
      if (!name) ctx.fail("runtime.error.missingVariable", { name: "" });
      return ctx.getVariable(name);
    },
  },
];
