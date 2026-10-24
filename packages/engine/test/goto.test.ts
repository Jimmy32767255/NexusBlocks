import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlock,
  createProject,
  type BlockNode,
  type Project,
} from "@nexus/ir";
import { runProject, type RuntimeEvent } from "../src/index.ts";

function start(body: BlockNode[]): BlockNode {
  return createBlock("control.start", { inputs: { body } });
}

function label(name: string): BlockNode {
  return createBlock("control.label", { fields: { name } });
}

function jump(name: string): BlockNode {
  return createBlock("control.goto", { fields: { name } });
}

function print(text: string): BlockNode {
  return createBlock("io.print", { fields: { text } });
}

function loggedTexts(events: RuntimeEvent[]): string[] {
  return events.flatMap((event) => (event.kind === "log" ? [event.text] : []));
}

test("goto forward skips the statements in between", async () => {
  const project = createProject();
  project.scripts = [start([jump("skip"), print("skipped"), label("skip"), print("after")])];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["after"]);
});

test("goto backward loops until the counter reaches the bound", async () => {
  const project: Project = createProject();
  project.scripts = [
    start([
      createBlock("var.create", {
        fields: { name: "total", type: "number" },
        inputs: { value: createBlock("math.number", { fields: { value: 0 } }) },
      }),
      createBlock("var.set", {
        fields: { variable: "total" },
        inputs: { value: createBlock("math.number", { fields: { value: 0 } }) },
      }),
      label("again"),
      createBlock("var.set", {
        fields: { variable: "total" },
        inputs: {
          value: createBlock("math.arithmetic", {
            fields: { op: "+" },
            inputs: {
              a: createBlock("var.get", { fields: { variable: "total" } }),
              b: createBlock("math.number", { fields: { value: 1 } }),
            },
          }),
        },
      }),
      createBlock("io.print", { inputs: { text: createBlock("var.get", { fields: { variable: "total" } }) } }),
      createBlock("control.if", {
        inputs: {
          condition: createBlock("logic.compare", {
            fields: { op: "<" },
            inputs: {
              a: createBlock("var.get", { fields: { variable: "total" } }),
              b: createBlock("math.number", { fields: { value: 3 } }),
            },
          }),
          then: [jump("again")],
        },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["1", "2", "3"]);
});

test("a label inside a branch resumes and then continues after the if", async () => {
  const project = createProject();
  project.scripts = [
    start([
      jump("inside"),
      print("skipped"),
      createBlock("control.if", {
        inputs: {
          condition: createBlock("logic.boolean", { fields: { value: true } }),
          then: [print("before label"), label("inside"), print("after label")],
        },
      }),
      print("after if"),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["after label", "after if"]);
});

test("goto out of a loop leaves the loop and continues after it", async () => {
  const project = createProject();
  project.scripts = [
    start([
      createBlock("control.repeat", {
        inputs: {
          times: createBlock("math.number", { fields: { value: 3 } }),
          body: [print("in loop"), jump("done")],
        },
      }),
      print("between"),
      label("done"),
      print("done"),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["in loop", "done"]);
});

test("an unknown label fails the run", async () => {
  const project = createProject();
  project.scripts = [start([jump("missing")])];
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.unknownLabel");
});
