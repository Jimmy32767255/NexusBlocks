import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const IO = CATEGORY_COLORS.io;

export const ioBlocks: BlockDefinition[] = [
  {
    type: "io.print",
    kind: "statement",
    category: "io",
    label: "block.io.print.label",
    description: "block.io.print.description",
    output: "void",
    color: IO,
    fields: [],
    ports: [{ name: "text", label: "block.io.print.port.text", kind: "value", type: "any", default: "" }],
    async execute(ctx, node) {
      const value = await ctx.input(node, "text");
      ctx.print(value, node.id);
    },
  },
];
