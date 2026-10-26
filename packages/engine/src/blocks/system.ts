import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const SYSTEM = CATEGORY_COLORS.system;

export const systemBlocks: BlockDefinition[] = [
  {
    type: "sys.exit",
    kind: "statement",
    category: "system",
    terminal: true,
    label: "block.sys.exit.label",
    description: "block.sys.exit.description",
    output: "void",
    color: SYSTEM,
    fields: [],
    ports: [{ name: "code", label: "block.sys.exit.port.code", kind: "value", type: "number", default: 0 }],
    async execute(ctx, node) {
      const raw = await ctx.input(node, "code");
      const code = Number(raw);
      if (!Number.isFinite(code)) {
        ctx.fail("runtime.error.badType", { from: typeof raw, to: "number" });
      }
      ctx.exit(Math.trunc(code));
    },
  },
  {
    type: "sys.args",
    kind: "expression",
    category: "system",
    label: "block.sys.args.label",
    description: "block.sys.args.description",
    output: "list",
    color: SYSTEM,
    fields: [],
    ports: [],
    evaluate(ctx) {
      return [...ctx.args];
    },
  },
  {
    type: "sys.setArgs",
    kind: "statement",
    category: "system",
    label: "block.sys.setArgs.label",
    description: "block.sys.setArgs.description",
    output: "void",
    color: SYSTEM,
    fields: [],
    ports: [{ name: "args", label: "block.sys.setArgs.port.args", kind: "value", type: "list" }],
    async execute(ctx, node) {
      const raw = await ctx.input(node, "args");
      if (!Array.isArray(raw)) {
        ctx.fail("runtime.error.badType", { from: typeof raw, to: "list" });
        return;
      }
      ctx.setArgs(raw.map((item) => String(item)));
    },
  },
];
