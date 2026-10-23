import {
  FUNCTION_DEFINE_ACTION_TYPE,
  FUNCTION_DEFINE_TYPE,
  FUNCTION_DEFINE_VALUE_TYPE,
  FUNCTION_PARAM_TYPE,
  FUNCTION_RETURN_TYPE,
  createFunctionCallSchema,
  type BlockNode,
  type FunctionDecl,
  type Value,
} from "@nexus/ir";
import type { BlockDefinition, ExecutionContext } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const FUNCTIONS = CATEGORY_COLORS.functions;

/** Leave the current function, carrying an optional result. */
export class ReturnSignal extends Error {
  readonly value: Value;

  constructor(value: Value) {
    super("return");
    this.name = "ReturnSignal";
    this.value = value;
  }
}

const DEFINE_FIELDS: BlockDefinition["fields"] = [
  { name: "name", kind: "text", label: "block.func.define.field.name", default: "function", required: true },
  { name: "params", kind: "params", label: "block.func.define.field.params", default: "" },
];

export const functionBlocks: BlockDefinition[] = [
  {
    type: FUNCTION_DEFINE_VALUE_TYPE,
    kind: "hat",
    category: "functions",
    label: "block.func.defineValue.label",
    description: "block.func.defineValue.description",
    output: "void",
    color: FUNCTIONS,
    fields: [
      ...DEFINE_FIELDS,
      {
        name: "returnType",
        kind: "select",
        label: "block.func.define.field.returnType",
        default: "any",
        options: [
          { value: "any", label: "any" },
          { value: "text", label: "text" },
          { value: "number", label: "number" },
          { value: "boolean", label: "boolean" },
          { value: "list", label: "list" },
          { value: "dict", label: "dict" },
        ],
      },
    ],
    ports: [{ name: "body", label: "block.func.define.port.body", kind: "stack" }],
    execute() {
      // Definitions are only run when called.
    },
  },
  {
    type: FUNCTION_DEFINE_ACTION_TYPE,
    kind: "hat",
    category: "functions",
    label: "block.func.defineAction.label",
    description: "block.func.defineAction.description",
    output: "void",
    color: FUNCTIONS,
    fields: DEFINE_FIELDS,
    ports: [{ name: "body", label: "block.func.define.port.body", kind: "stack" }],
    execute() {
      // Definitions are only run when called.
    },
  },
  {
    type: FUNCTION_DEFINE_TYPE,
    kind: "hat",
    category: "functions",
    label: "block.func.legacy.label",
    description: "block.func.legacy.description",
    output: "void",
    color: FUNCTIONS,
    hidden: true,
    fields: [
      ...DEFINE_FIELDS,
      { name: "returnType", kind: "text", label: "block.func.define.field.returnType", default: "any" },
    ],
    ports: [{ name: "body", label: "block.func.define.port.body", kind: "stack" }],
    execute() {
      // Legacy definitions open as value functions.
    },
  },
  {
    type: FUNCTION_PARAM_TYPE,
    kind: "expression",
    category: "functions",
    label: "block.func.param.label",
    description: "block.func.param.description",
    output: "any",
    color: FUNCTIONS,
    fields: [
      { name: "name", kind: "text", label: "block.func.param.field.name", default: "", required: true },
    ],
    ports: [],
    evaluate(ctx, node) {
      return ctx.getParam(String(node.fields?.name ?? ""));
    },
  },
  {
    type: FUNCTION_RETURN_TYPE,
    kind: "statement",
    category: "functions",
    label: "block.func.return.label",
    description: "block.func.return.description",
    output: "void",
    color: FUNCTIONS,
    fields: [],
    ports: [{ name: "value", label: "block.func.return.port.value", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      throw new ReturnSignal(await ctx.input(node, "value"));
    },
  },
];

/** Turn one declaration into the call block users drag from the toolbox. */
export function createFunctionCallBlock(decl: FunctionDecl): BlockDefinition {
  const schema = createFunctionCallSchema(decl);
  const readArgs = async (ctx: ExecutionContext, node: BlockNode): Promise<Value[]> => {
    const args: Value[] = [];
    for (const param of decl.params) args.push(await ctx.input(node, param.name));
    return args;
  };
  if (schema.kind === "expression") {
    return {
      ...schema,
      color: FUNCTIONS,
      async evaluate(ctx, node) {
        return ctx.callFunction(decl.id, await readArgs(ctx, node));
      },
    };
  }
  return {
    ...schema,
    color: FUNCTIONS,
    async execute(ctx, node) {
      await ctx.callFunction(decl.id, await readArgs(ctx, node));
    },
  };
}
