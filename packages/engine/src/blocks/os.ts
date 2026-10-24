import { RuntimeFailure } from "../errors.ts";
import { OS_EXEC_CAPABILITY } from "../host.ts";
import { toDisplayText, type Value } from "@nexus/ir";
import type { BlockDefinition } from "../types.ts";
import { CATEGORY_COLORS } from "./control.ts";

const SYSTEM = CATEGORY_COLORS.system;

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

function asCommandResult(value: Value): CommandResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { stdout: "", stderr: "", code: 0 };
  }
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
  const code = typeof value.code === "number" ? value.code : 0;
  return { stdout: text("stdout"), stderr: text("stderr"), code };
}

export const osBlocks: BlockDefinition[] = [
  {
    type: "os.exec_command",
    platforms: "desktop",
    kind: "statement",
    category: "system",
    output: "void",
    label: "block.os.exec.label",
    description: "block.os.exec.description",
    color: SYSTEM,
    fields: [],
    ports: [{ name: "command", label: "block.os.exec.port.command", kind: "value", type: "text", default: "" }],
    async execute(ctx, node) {
      const command = toDisplayText(await ctx.input(node, "command"));
      if (command.trim() === "") throw new RuntimeFailure("runtime.error.emptyCommand");
      const result = asCommandResult(
        await ctx.host.invoke({ capability: OS_EXEC_CAPABILITY, args: [command], blockId: node.id }),
      );
      const stdout = result.stdout.trimEnd();
      if (stdout !== "") ctx.print(stdout);
      const stderr = result.stderr.trimEnd();
      if (result.code !== 0) {
        if (stderr !== "") ctx.print(stderr);
        throw new RuntimeFailure("runtime.error.commandFailed", { code: result.code });
      }
    },
  },
];
