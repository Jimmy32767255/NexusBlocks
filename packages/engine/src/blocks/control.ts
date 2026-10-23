import { BreakSignal } from "../errors.ts";
import type { BlockDefinition } from "../types.ts";

/** Category colours are shared by the toolbox and the canvas. */
export const CATEGORY_COLORS = {
  control: "#e0a02c",
  io: "#4c7dff",
  text: "#8f6bea",
  math: "#3fae6a",
  logic: "#e2607f",
  variables: "#e88432",
  data: "#2aa6a6",
  functions: "#9b6bff",
  files: "#6a8caf",
} as const;

const CONTROL = CATEGORY_COLORS.control;

export const controlBlocks: BlockDefinition[] = [
  {
    type: "control.start",
    kind: "hat",
    category: "control",
    label: "block.control.start.label",
    description: "block.control.start.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [{ name: "body", label: "block.control.start.port.body", kind: "stack" }],
    async execute(ctx, node) {
      await ctx.run(ctx.stack(node, "body"));
    },
  },
  {
    type: "control.if",
    kind: "statement",
    category: "control",
    label: "block.control.if.label",
    description: "block.control.if.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "condition", label: "block.control.if.port.condition", kind: "value", type: "boolean", default: false },
      { name: "then", label: "block.control.if.port.then", kind: "stack" },
      { name: "else", label: "block.control.if.port.else", kind: "stack" },
    ],
    async execute(ctx, node) {
      const condition = await ctx.input(node, "condition");
      if (condition) {
        await ctx.run(ctx.stack(node, "then"));
      } else {
        await ctx.run(ctx.stack(node, "else"));
      }
    },
  },
  {
    type: "control.repeat",
    kind: "statement",
    category: "control",
    label: "block.control.repeat.label",
    description: "block.control.repeat.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "times", label: "block.control.repeat.port.times", kind: "value", type: "number", default: 10 },
      { name: "body", label: "block.control.repeat.port.body", kind: "stack" },
    ],
    async execute(ctx, node) {
      const raw = await ctx.input(node, "times");
      const times = Math.max(0, Math.floor(Number(raw) || 0));
      for (let index = 0; index < times; index += 1) {
        await ctx.tick();
        try {
          await ctx.run(ctx.stack(node, "body"));
        } catch (error) {
          if (error instanceof BreakSignal) break;
          throw error;
        }
      }
    },
  },
  {
    type: "control.break",
    kind: "statement",
    category: "control",
    label: "block.control.break.label",
    description: "block.control.break.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [],
    execute() {
      throw new BreakSignal();
    },
  },
  {
    type: "control.wait",
    kind: "statement",
    category: "control",
    label: "block.control.wait.label",
    description: "block.control.wait.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "seconds", label: "block.control.wait.port.seconds", kind: "value", type: "number", default: 1 },
    ],
    async execute(ctx, node) {
      const raw = await ctx.input(node, "seconds");
      const seconds = Math.max(0, Number(raw) || 0);
      await ctx.sleep(seconds * 1000);
    },
  },
];
