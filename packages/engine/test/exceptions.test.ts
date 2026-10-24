import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBlock,
  createProject,
  validateProject,
  type BlockNode,
  type Project,
} from "@nexus/ir";
import { defaultRegistry, runProject } from "../src/index.ts";

function start(body: BlockNode[]): BlockNode {
  return createBlock("control.start", { inputs: { body } });
}

function declare(name: string, type: string, value: BlockNode): BlockNode {
  return createBlock("var.create", { fields: { name, type }, inputs: { value } });
}

function print(value: string | BlockNode): BlockNode {
  return typeof value === "string"
    ? createBlock("io.print", { fields: { text: value } })
    : createBlock("io.print", { inputs: { text: value } });
}

function projectWith(script: BlockNode): Project {
  const project = createProject({ name: "exceptions", locale: "en" });
  project.scripts.push(script);
  return project;
}

async function run(project: Project): Promise<{ logs: string[]; status: string; key?: string }> {
  const logs: string[] = [];
  const result = await runProject(project, {
    registry: defaultRegistry,
    onEvent: (event) => {
      if (event.kind === "log") logs.push(event.text);
    },
  });
  return { logs, status: result.status, key: result.error?.messageKey };
}

test("catch handles a matching thrown value", async () => {
  const thrown = createBlock("control.throw", { fields: { value: "boom" } });
  const handler = createBlock("control.catch", { inputs: { body: [print("caught")] } });
  const script = start([
    createBlock("control.try", { inputs: { body: [thrown], catches: [handler] } }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.deepEqual(result.logs, ["caught"]);
});

test("a non-matching catch lets the exception escape", async () => {
  const thrown = createBlock("control.throw", { fields: { value: "boom" } });
  const handler = createBlock("control.catchType", {
    fields: { exception: "number" },
    inputs: { body: [print("wrong")] },
  });
  const script = start([
    createBlock("control.try", { inputs: { body: [thrown], catches: [handler] } }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "error");
  assert.deepEqual(result.logs, []);
});

test("typed catch stores the message in a variable", async () => {
  const thrown = createBlock("control.throw", { fields: { value: "kaboom" } });
  const show = print(createBlock("var.get", { fields: { variable: "err" } }));
  const handler = createBlock("control.catchAssign", {
    fields: { exception: "text", target: "err" },
    inputs: { body: [show] },
  });
  const script = start([
    declare("err", "text", createBlock("text.literal", { fields: { value: "" } })),
    createBlock("control.try", { inputs: { body: [thrown], catches: [handler] } }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.deepEqual(result.logs, ["kaboom"]);
});

test("catch is skipped when nothing is thrown", async () => {
  const handler = createBlock("control.catch", { inputs: { body: [print("caught")] } });
  const script = start([
    createBlock("control.try", { inputs: { body: [print("ok")], catches: [handler] } }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.deepEqual(result.logs, ["ok"]);
});

test("runtime errors can be caught as text", async () => {
  const show = print(createBlock("var.get", { fields: { variable: "err" } }));
  const handler = createBlock("control.catchAssign", {
    fields: { exception: "error", target: "err" },
    inputs: { body: [show] },
  });
  const divide = createBlock("math.arithmetic", {
    fields: { op: "/" },
    inputs: {
      a: createBlock("math.number", { fields: { value: 1 } }),
      b: createBlock("math.number", { fields: { value: 0 } }),
    },
  });
  const script = start([
    declare("err", "text", createBlock("text.literal", { fields: { value: "" } })),
    createBlock("control.try", {
      inputs: { body: [print(divide)], catches: [handler] },
    }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.equal(result.logs[0], "runtime.error.divisionByZero");
});

test("break signals are not swallowed by catch", async () => {
  const handler = createBlock("control.catch", { inputs: { body: [print("caught")] } });
  const loop = createBlock("control.repeat", {
    fields: { times: 1 },
    inputs: { body: [createBlock("control.break")] },
  });
  const script = start([
    createBlock("control.try", { inputs: { body: [loop], catches: [handler] } }),
    print("after"),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.deepEqual(result.logs, ["after"]);
});

test("catch blocks outside a try are rejected", () => {
  const script = start([
    createBlock("control.catch", { inputs: { body: [] } }),
  ]);
  const project = projectWith(script);
  const codes = validateProject(project, defaultRegistry).map((diagnostic) => diagnostic.code);
  assert.ok(codes.includes("catch.misplaced"));
});

test("non-catch children in the catch stack are rejected", () => {
  const script = start([
    createBlock("control.try", {
      inputs: { body: [], catches: [print("nope") as BlockNode] },
    }),
  ]);
  const codes = validateProject(projectWith(script), defaultRegistry).map((d) => d.code);
  assert.ok(codes.includes("catch.invalid"));
});

test("a thrown list is matched by its value type", async () => {
  const handler = createBlock("control.catchType", {
    fields: { exception: "list" },
    inputs: { body: [print("list")] },
  });
  const list = createBlock("control.throw", {
    inputs: { value: createBlock("list.literal", { fields: { items: "[1, 2]" } }) },
  });
  const script = start([
    createBlock("control.try", { inputs: { body: [list], catches: [handler] } }),
  ]);
  const result = await run(projectWith(script));
  assert.equal(result.status, "finished");
  assert.deepEqual(result.logs, ["list"]);
});
