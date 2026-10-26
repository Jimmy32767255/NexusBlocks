import assert from "node:assert/strict";
import { test } from "node:test";

import { createBlock, createProject, type BlockNode } from "@nexus/ir";
import { runProject, type RuntimeEvent } from "../src/index.ts";

function text(value: string): BlockNode {
  return createBlock("text.literal", { fields: { value } });
}

function num(value: number): BlockNode {
  return createBlock("math.number", { fields: { value } });
}

function printed(node: BlockNode): BlockNode {
  return createBlock("io.print", { inputs: { text: node } });
}

async function run(statements: BlockNode[]) {
  const project = createProject();
  project.scripts = [createBlock("control.start", { inputs: { body: statements } })];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  const logs = events.filter((event) => event.kind === "log").map((event) => (event as { text: string }).text);
  return { result, logs };
}

test("text length counts Unicode code points", async () => {
  const { result, logs } = await run([printed(createBlock("text.length", { inputs: { text: text("a😀b") } }))]);
  assert.equal(result.status, "finished");
  assert.deepEqual(logs, ["3"]);
});

test("charAt and slice address characters by code point", async () => {
  const { logs } = await run([
    printed(createBlock("text.charAt", { inputs: { text: text("a😀b"), index: num(1) } })),
    printed(createBlock("text.slice", { inputs: { text: text("a😀b"), start: num(1), length: num(2) } })),
    printed(createBlock("text.slice", { inputs: { text: text("abc"), start: num(2), length: num(5) } })),
    printed(createBlock("text.slice", { inputs: { text: text("abc"), start: num(3), length: num(2) } })),
  ]);
  assert.deepEqual(logs, ["😀", "😀b", "c", ""]);
});

test("indexOf reports character positions", async () => {
  const { logs } = await run([
    printed(createBlock("text.indexOf", { inputs: { text: text("a😀b😀"), needle: text("😀") } })),
    printed(createBlock("text.indexOf", { inputs: { text: text("😀a"), needle: text("a") } })),
    printed(createBlock("text.indexOf", { inputs: { text: text("abc"), needle: text("z") } })),
    printed(createBlock("text.indexOf", { inputs: { text: text("abc"), needle: text("") } })),
  ]);
  assert.deepEqual(logs, ["1", "1", "-1", "0"]);
});

test("split returns every piece as a list", async () => {
  const { logs } = await run([
    printed(createBlock("text.split", { inputs: { text: text("a,b,,c"), separator: text(",") } })),
  ]);
  assert.deepEqual(logs, ["[a, b, , c]"]);
});

test("codePoint and fromCodePoint roundtrip astral characters", async () => {
  const { logs } = await run([
    printed(createBlock("text.codePoint", { inputs: { text: text("😀") } })),
    printed(createBlock("text.codePoint", { inputs: { text: text("abc") } })),
    printed(createBlock("text.fromCodePoint", { inputs: { code: num(128512) } })),
    printed(createBlock("text.fromCodePoint", { inputs: { code: num(97) } })),
  ]);
  assert.deepEqual(logs, ["128512", "97", "😀", "a"]);
});

test("out-of-range character access raises textIndex", async () => {
  const charAt = await run([printed(createBlock("text.charAt", { inputs: { text: text("abc"), index: num(3) } }))]);
  assert.equal(charAt.result.status, "error");
  assert.equal(charAt.result.error?.messageKey, "runtime.error.textIndex");
  assert.deepEqual(charAt.result.error?.params, { index: 3, length: 3 });

  const negative = await run([printed(createBlock("text.charAt", { inputs: { text: text("abc"), index: num(-1) } }))]);
  assert.equal(negative.result.status, "error");
  assert.equal(negative.result.error?.messageKey, "runtime.error.textIndex");

  const slice = await run([
    printed(createBlock("text.slice", { inputs: { text: text("abc"), start: num(4), length: num(1) } })),
  ]);
  assert.equal(slice.result.status, "error");
  assert.deepEqual(slice.result.error?.params, { index: 4, length: 3 });
});

test("invalid split, empty text and bad code points raise readably", async () => {
  const split = await run([printed(createBlock("text.split", { inputs: { text: text("abc"), separator: text("") } }))]);
  assert.equal(split.result.error?.messageKey, "runtime.error.splitSeparator");

  const empty = await run([printed(createBlock("text.codePoint", { inputs: { text: text("") } }))]);
  assert.equal(empty.result.error?.messageKey, "runtime.error.emptyText");

  const tooBig = await run([printed(createBlock("text.fromCodePoint", { inputs: { code: num(0x110000) } }))]);
  assert.equal(tooBig.result.error?.messageKey, "runtime.error.badCodePoint");
  assert.deepEqual(tooBig.result.error?.params, { value: "1114112" });

  const fractional = await run([printed(createBlock("text.fromCodePoint", { inputs: { code: num(1.5) } }))]);
  assert.equal(fractional.result.error?.messageKey, "runtime.error.badCodePoint");
});
