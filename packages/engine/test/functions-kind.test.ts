import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlock,
  createProject,
  functionCallType,
  validateProject,
  type BlockNode,
  type Project,
} from "@nexus/ir";
import { createProjectRegistry, runProject, type RuntimeEvent } from "../src/index.ts";

function defineAction(id: string, body: BlockNode[]): BlockNode {
  return createBlock("func.define_action", {
    id,
    fields: { name: "greet", params: "" },
    inputs: { body },
  });
}

test("action functions produce statement calls that run their body", async () => {
  const hat = defineAction("f1", [
    createBlock("io.print", { fields: { text: "hi from action" } }),
  ]);
  const call = createBlock(functionCallType("f1"));
  const main = createBlock("control.start", { inputs: { body: [call] } });
  const project: Project = createProject({ name: "action" });
  project.scripts.push(hat, main);

  const diagnostics = validateProject(project, createProjectRegistry(project));
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0, JSON.stringify(diagnostics));

  const events: RuntimeEvent[] = [];
  const result = await runProject(project, {
    registry: createProjectRegistry(project),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.status, "finished");
  assert.deepEqual(
    events.filter((e) => e.kind === "log").map((e) => (e.kind === "log" ? e.text : "")),
    ["hi from action"],
  );
});

test("return blocks are rejected inside action functions", () => {
  const hat = defineAction("f2", [
    createBlock("func.return", { fields: { value: "" } }),
  ]);
  const project: Project = createProject({ name: "bad" });
  project.scripts.push(hat);
  const diagnostics = validateProject(project, createProjectRegistry(project));
  assert.ok(diagnostics.some((d) => d.code === "function.returnInAction"));
});

test("legacy func.define still reads as a value function", () => {
  const hat = createBlock("func.define", {
    id: "f3",
    fields: { name: "answer", params: "", returnType: "number" },
    inputs: { body: [createBlock("func.return", { fields: { value: 42 } })] },
  });
  const project: Project = createProject({ name: "legacy" });
  project.scripts.push(hat);
  const diagnostics = validateProject(project, createProjectRegistry(project));
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0, JSON.stringify(diagnostics));
});

test("variables can be passed as function arguments", async () => {
  const hat = createBlock("func.define_value", {
    id: "sq",
    fields: { name: "square", params: "x: number", returnType: "number" },
    inputs: { body: [createBlock("func.return", {
      inputs: { value: createBlock("math.arithmetic", {
        fields: { op: "*" },
        inputs: { a: createBlock("func.param", { fields: { name: "x" } }), b: createBlock("func.param", { fields: { name: "x" } }) },
      }) },
    })] },
  });
  const call = createBlock(functionCallType("sq"), {
    inputs: { x: createBlock("var.get", { fields: { variable: "n" } }) },
  });
  const main = createBlock("control.start", { inputs: { body: [
    createBlock("var.create", {
      fields: { name: "n", type: "number" },
      inputs: { value: createBlock("math.number", { fields: { value: 4 } }) },
    }),
    createBlock("io.print", { inputs: { text: call } }),
  ] } });
  const project: Project = createProject({ name: "vars" });
  project.scripts.push(hat, main);

  const registry = createProjectRegistry(project);
  const diagnostics = validateProject(project, registry);
  assert.equal(diagnostics.filter((d) => d.severity === "error").length, 0, JSON.stringify(diagnostics));
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { registry, onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(events.filter((e) => e.kind === "log").map((e) => (e.kind === "log" ? e.text : "")), ["16"]);
});
