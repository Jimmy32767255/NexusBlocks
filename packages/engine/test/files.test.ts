import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlock, createProject, type BlockNode } from "@nexus/ir";
import { memoryStorage, runProject, type RuntimeEvent } from "../src/index.ts";

function start(body: BlockNode[]): BlockNode {
  return createBlock("control.start", { inputs: { body } });
}

function projectWith(...scripts: BlockNode[]) {
  const project = createProject();
  project.scripts.push(...scripts);
  return project;
}

function loggedTexts(events: RuntimeEvent[]): string[] {
  return events.filter((event) => event.kind === "log").map((event) => event.text);
}

test("workspace files can be written, read, listed and deleted", async () => {
  const storage = memoryStorage();
  const project = projectWith(
    start([
      createBlock("file.write", {
        inputs: {
          path: createBlock("text.literal", { fields: { value: "notes.txt" } }),
          content: createBlock("text.literal", { fields: { value: "hello" } }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("file.read", {
            inputs: { path: createBlock("text.literal", { fields: { value: "notes.txt" } }) },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("file.exists", {
            inputs: { path: createBlock("text.literal", { fields: { value: "notes.txt" } }) },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: { text: createBlock("file.list") },
      }),
      createBlock("file.delete", {
        inputs: { path: createBlock("text.literal", { fields: { value: "notes.txt" } }) },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("file.exists", {
            inputs: { path: createBlock("text.literal", { fields: { value: "notes.txt" } }) },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { storage, onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["hello", "true", "[notes.txt]", "false"]);
});

test("file paths cannot escape the workspace", async () => {
  const project = projectWith(
    start([
      createBlock("file.write", {
        inputs: {
          path: createBlock("text.literal", { fields: { value: "../secret.txt" } }),
          content: createBlock("text.literal", { fields: { value: "nope" } }),
        },
      }),
    ]),
  );
  const result = await runProject(project, { storage: memoryStorage() });
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.filePath");
});

test("reading a missing file reports a translatable error", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("file.read", {
            inputs: { path: createBlock("text.literal", { fields: { value: "missing.txt" } }) },
          }),
        },
      }),
    ]),
  );
  const result = await runProject(project, { storage: memoryStorage() });
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.fileNotFound");
});
