import { countField, toDisplayText, typeOf, type FieldDef, type PortDef } from "@nexus/ir";
import { BreakSignal, RuntimeFailure, StopSignal, ThrowSignal } from "../errors.ts";
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
  modules: "#c47f42",
  system: "#7d8794",
  convert: "#57a58f",
  comment: "#a8975c",
} as const;

const IF_ELSEIFS: FieldDef = {
  name: "elseIfs",
  kind: "count",
  label: "block.control.if.field.elseIfs",
  default: 0,
  min: 0,
  max: 4,
};

const CONTROL = CATEGORY_COLORS.control;

const EXCEPTION_FILTERS = ["any", "error", "text", "number", "boolean", "list", "dict"] as const;

function exceptionOptions(): { value: string; label: string; labelKey: string }[] {
  return EXCEPTION_FILTERS.map((value) => ({
    value,
    label: value,
    labelKey: `block.control.catch.option.${value}`,
  }));
}

/** Does a catch branch accept this thrown value or runtime failure? */
function matchesException(filter: string, error: ThrowSignal | RuntimeFailure): boolean {
  if (filter === "any") return true;
  if (error instanceof RuntimeFailure) return filter === "error";
  return typeOf(error.value) === filter;
}

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
    fields: [IF_ELSEIFS],
    ports: [],
    dynamicPorts(node): PortDef[] {
      const count = countField(node, IF_ELSEIFS);
      const ports: PortDef[] = [
        { name: "condition", label: "block.control.if.port.condition", kind: "value", type: "boolean", default: false },
        { name: "then", label: "block.control.if.port.then", kind: "stack" },
      ];
      for (let index = 1; index <= count; index += 1) {
        ports.push(
          { name: `elseIf${index}`, label: "block.control.if.port.elseIfCondition", kind: "value", type: "boolean", default: false },
          { name: `elseIf${index}Body`, label: "block.control.if.port.elseIfBody", kind: "stack" },
        );
      }
      ports.push({ name: "else", label: "block.control.if.port.else", kind: "stack" });
      return ports;
    },
    async execute(ctx, node) {
      if (await ctx.input(node, "condition")) {
        await ctx.run(ctx.stack(node, "then"));
        return;
      }
      for (let index = 1; index <= countField(node, IF_ELSEIFS); index += 1) {
        if (await ctx.input(node, `elseIf${index}`)) {
          await ctx.run(ctx.stack(node, `elseIf${index}Body`));
          return;
        }
      }
      await ctx.run(ctx.stack(node, "else"));
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
    type: "control.forever",
    kind: "statement",
    category: "control",
    label: "block.control.forever.label",
    description: "block.control.forever.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [{ name: "body", label: "block.control.forever.port.body", kind: "stack" }],
    async execute(ctx, node) {
      for (;;) {
        await ctx.tick();
        try {
          await ctx.run(ctx.stack(node, "body"));
        } catch (error) {
          if (error instanceof BreakSignal) return;
          throw error;
        }
      }
    },
  },
  {
    type: "control.while",
    kind: "statement",
    category: "control",
    label: "block.control.while.label",
    description: "block.control.while.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "condition", label: "block.control.while.port.condition", kind: "value", type: "boolean", default: false },
      { name: "body", label: "block.control.while.port.body", kind: "stack" },
    ],
    async execute(ctx, node) {
      while (await ctx.input(node, "condition")) {
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
    type: "control.repeatWith",
    kind: "statement",
    category: "control",
    label: "block.control.repeatWith.label",
    description: "block.control.repeatWith.description",
    output: "void",
    color: CONTROL,
    fields: [
      {
        name: "variable",
        kind: "variable",
        label: "block.control.repeatWith.field.variable",
        default: "",
        required: true,
      },
    ],
    ports: [
      { name: "times", label: "block.control.repeatWith.port.times", kind: "value", type: "number", default: 10 },
      { name: "body", label: "block.control.repeatWith.port.body", kind: "stack" },
    ],
    async execute(ctx, node) {
      const raw = await ctx.input(node, "times");
      const times = Math.max(0, Math.floor(Number(raw) || 0));
      const variableId = String(node.fields?.variable ?? "");
      if (!variableId) ctx.fail("runtime.error.missingVariable", { name: "" });
      for (let count = 1; count <= times; count += 1) {
        ctx.setVariable(variableId, count);
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
    terminal: true,
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
    type: "control.pass",
    kind: "statement",
    category: "control",
    label: "block.control.pass.label",
    description: "block.control.pass.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [],
    execute() {},
  },
  {
    type: "control.throw",
    kind: "statement",
    category: "control",
    terminal: true,
    label: "block.control.throw.label",
    description: "block.control.throw.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "value", label: "block.control.throw.port.value", kind: "value", type: "any", default: "error" },
    ],
    async execute(ctx, node) {
      const value = await ctx.input(node, "value");
      throw new ThrowSignal(value, node.id);
    },
  },
  {
    type: "control.try",
    kind: "statement",
    category: "control",
    label: "block.control.try.label",
    description: "block.control.try.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [
      { name: "body", label: "block.control.try.port.body", kind: "stack" },
      { name: "catches", label: "block.control.try.port.catches", kind: "stack" },
    ],
    async execute(ctx, node) {
      let caught: unknown;
      try {
        await ctx.run(ctx.stack(node, "body"));
        return;
      } catch (error) {
        if (error instanceof StopSignal || error instanceof BreakSignal) throw error;
        caught = error;
      }
      if (!(caught instanceof ThrowSignal) && !(caught instanceof RuntimeFailure)) throw caught;

      for (const branch of ctx.stack(node, "catches")) {
        const filter = String(branch.fields?.exception ?? "any");
        if (!matchesException(filter, caught)) continue;
        const target = branch.fields?.target;
        if (typeof target === "string" && target) {
          const text =
            caught instanceof RuntimeFailure
              ? ctx.describeFailure(caught)
              : toDisplayText(caught.value);
          ctx.setVariable(target, text);
        }
        await ctx.run(ctx.stack(branch, "body"));
        return;
      }
      throw caught;
    },
  },
  {
    type: "control.catch",
    kind: "statement",
    category: "control",
    label: "block.control.catch.label",
    description: "block.control.catch.description",
    output: "void",
    color: CONTROL,
    fields: [],
    ports: [{ name: "body", label: "block.control.catch.port.body", kind: "stack" }],
    /** Catch branches only run when their owning try block hands over control. */
    execute() {},
  },
  {
    type: "control.catchType",
    kind: "statement",
    category: "control",
    label: "block.control.catchType.label",
    description: "block.control.catchType.description",
    output: "void",
    color: CONTROL,
    fields: [
      {
        name: "exception",
        kind: "select",
        label: "block.control.catch.field.exception",
        default: "error",
        options: exceptionOptions(),
      },
    ],
    ports: [{ name: "body", label: "block.control.catch.port.body", kind: "stack" }],
    execute() {},
  },
  {
    type: "control.catchAssign",
    kind: "statement",
    category: "control",
    label: "block.control.catchAssign.label",
    description: "block.control.catchAssign.description",
    output: "void",
    color: CONTROL,
    fields: [
      {
        name: "exception",
        kind: "select",
        label: "block.control.catch.field.exception",
        default: "error",
        options: exceptionOptions(),
      },
      {
        name: "target",
        kind: "variable",
        label: "block.control.catchAssign.field.target",
        default: "",
        required: true,
      },
    ],
    ports: [{ name: "body", label: "block.control.catch.port.body", kind: "stack" }],
    execute() {},
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
