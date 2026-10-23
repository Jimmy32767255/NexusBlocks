import type { Value } from "@nexus/ir";
import { HostError } from "../host.ts";
import type { BlockDefinition, ExecutionContext } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const FILES = CATEGORY_COLORS.files;

async function invoke(
  ctx: ExecutionContext,
  capability: string,
  args: Value[],
  blockId: string,
): Promise<Value> {
  try {
    return await ctx.host.invoke({ capability, args, blockId });
  } catch (error) {
    if (error instanceof HostError) ctx.fail(error.messageKey, error.params);
    throw error;
  }
}

const PATH_PORT = (name: string, label: string) => ({
  name,
  label,
  kind: "value" as const,
  type: "text" as const,
  default: "notes.txt",
});

export const fileBlocks: BlockDefinition[] = [
  {
    type: "file.read",
    kind: "expression",
    category: "files",
    label: "block.file.read.label",
    description: "block.file.read.description",
    output: "text",
    color: FILES,
    fields: [],
    ports: [PATH_PORT("path", "block.file.read.port.path")],
    async evaluate(ctx, node) {
      const path = await ctx.input(node, "path");
      const text = await invoke(ctx, "fs.read", [path], node.id);
      return ctx.coerce(text, "text", node.id);
    },
  },
  {
    type: "file.write",
    kind: "statement",
    category: "files",
    label: "block.file.write.label",
    description: "block.file.write.description",
    output: "void",
    color: FILES,
    fields: [],
    ports: [
      PATH_PORT("path", "block.file.write.port.path"),
      { name: "content", label: "block.file.write.port.content", kind: "value", type: "any", default: "" },
    ],
    async execute(ctx, node) {
      const path = await ctx.input(node, "path");
      const content = await ctx.input(node, "content");
      await invoke(ctx, "fs.write", [path, content], node.id);
    },
  },
  {
    type: "file.exists",
    kind: "expression",
    category: "files",
    label: "block.file.exists.label",
    description: "block.file.exists.description",
    output: "boolean",
    color: FILES,
    fields: [],
    ports: [PATH_PORT("path", "block.file.exists.port.path")],
    async evaluate(ctx, node) {
      const path = await ctx.input(node, "path");
      return Boolean(await invoke(ctx, "fs.exists", [path], node.id));
    },
  },
  {
    type: "file.delete",
    kind: "statement",
    category: "files",
    label: "block.file.delete.label",
    description: "block.file.delete.description",
    output: "void",
    color: FILES,
    fields: [],
    ports: [PATH_PORT("path", "block.file.delete.port.path")],
    async execute(ctx, node) {
      const path = await ctx.input(node, "path");
      await invoke(ctx, "fs.delete", [path], node.id);
    },
  },
  {
    type: "file.list",
    kind: "expression",
    category: "files",
    label: "block.file.list.label",
    description: "block.file.list.description",
    output: "list",
    color: FILES,
    fields: [],
    ports: [],
    async evaluate(ctx, node) {
      const value = await invoke(ctx, "fs.list", [], node.id);
      return ctx.coerce(value, "list", node.id);
    },
  },
];
