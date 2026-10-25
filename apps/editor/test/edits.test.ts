import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlock, createDocument, createProject, findBlock } from "@nexus/ir";
import { createStarterDocument, defaultRegistry } from "@nexus/engine";
import {
  appendToScript,
  createScriptWith,
  insertIntoStack,
  locateBlock,
  moveScript,
  newBlockInstance,
  plugIntoPort,
  removeBlock,
  unplugPort,
} from "../src/edits.ts";

function starter() {
  return createStarterDocument("en");
}

function instance(type: string, document = starter()) {
  const result = newBlockInstance(defaultRegistry, type);
  assert.equal(result.ok, true, `expected ${type} to instantiate`);
  if (!result.ok) throw new Error("unreachable");
  return result.node;
}

describe("editor edits", () => {
  it("fills declared fields with defaults", () => {
    const node = instance("logic.compare");
    assert.equal(node.type, "logic.compare");
    assert.equal(node.fields?.op, "==");
  });

  it("creates variable blocks with an empty name field", () => {
    const result = newBlockInstance(defaultRegistry, "var.set");
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.node.fields?.variable, "");
  });

  it("rejects unknown block types", () => {
    const result = newBlockInstance(defaultRegistry, "nope.missing");
    assert.deepEqual(result, { ok: false, reason: "unknown" });
  });

  it("inserts a statement into the starter script body", () => {
    const document = starter();
    const start = document.project.scripts[0];
    assert.ok(start);
    const print = instance("io.print");
    assert.equal(insertIntoStack(document.project, start.id, "body", 0, print), true);

    const body = findBlock(document.project, start.id)?.inputs?.body;
    assert.ok(Array.isArray(body));
    assert.equal(body[0]?.id, print.id);
  });

  it("indexes sibling statements correctly", () => {
    const document = starter();
    const start = document.project.scripts[0]!;
    const body = start.inputs?.body;
    assert.ok(Array.isArray(body));
    const first = body.length;

    const trailing = instance("io.print");
    insertIntoStack(document.project, start.id, "body", 99, trailing);
    const second = instance("io.print");
    insertIntoStack(document.project, start.id, "body", 1, second);

    const updated = findBlock(document.project, start.id)?.inputs?.body;
    assert.ok(Array.isArray(updated));
    assert.equal(updated.length, first + 2);
    assert.equal(updated[1]?.id, second.id);
  });

  it("plugs an expression into an empty value port and refuses occupied ones", () => {
    const document = starter();
    const start = document.project.scripts[0]!;
    const body = start.inputs?.body;
    assert.ok(Array.isArray(body));
    const print = body[0]!;

    const value = instance("text.literal");
    const current = findBlock(document.project, print.id)?.inputs?.text;
    if (current && !Array.isArray(current)) unplugPort(document.project, print.id, "text");
    assert.equal(plugIntoPort(document.project, print.id, "text", value), true);
    assert.equal(plugIntoPort(document.project, print.id, "text", instance("text.literal")), false);

    const unplugged = unplugPort(document.project, print.id, "text");
    assert.equal(unplugged?.id, value.id);
    assert.equal(findBlock(document.project, print.id)?.inputs?.text, undefined);
  });

  it("locates nested blocks with parent and port", () => {
    const document = starter();
    const start = document.project.scripts[0]!;
    const body = start.inputs?.body;
    assert.ok(Array.isArray(body));
    const print = body[0]!;

    const location = locateBlock(document.project, print.id);
    assert.ok(location);
    assert.equal(location.parent?.id, start.id);
    assert.equal(location.port, "body");
    assert.equal(location.stack[0]?.id, print.id);

    assert.equal(locateBlock(document.project, "missing"), null);
  });

  it("removes a nested block and keeps the rest of the script", () => {
    const document = starter();
    const start = document.project.scripts[0]!;
    const body = start.inputs?.body;
    assert.ok(Array.isArray(body));
    const print = body[0]!;

    assert.equal(removeBlock(document, print.id), true);
    assert.equal(removeBlock(document, print.id), false);
    assert.deepEqual(findBlock(document.project, start.id)?.inputs?.body, []);
  });

  it("removing a top-level hat drops its script", () => {
    const document = starter();
    const start = document.project.scripts[0]!;
    assert.equal(removeBlock(document, start.id), true);
    assert.equal(document.project.scripts.length, 0);
  });

  it("moves top-level scripts up and down, refusing to cross the edges", () => {
    const doc = starter();
    const first = doc.project.scripts[0]!;
    const second = createBlock("control.start", { inputs: { body: [] } });
    const third = createBlock("control.start", { inputs: { body: [] } });
    doc.project.scripts.push(second, third);

    assert.equal(moveScript(doc.project, second.id, -1), true);
    assert.deepEqual(doc.project.scripts.map((node) => node.id), [second.id, first.id, third.id]);

    assert.equal(moveScript(doc.project, second.id, -1), false);
    assert.equal(moveScript(doc.project, third.id, 1), false);
    assert.equal(moveScript(doc.project, third.id, -1), true);
    assert.deepEqual(doc.project.scripts.map((node) => node.id), [second.id, third.id, first.id]);
    assert.equal(moveScript(doc.project, "missing", 1), false);
  });

  it("creates a new script around a dropped statement", () => {
    const document = createDocument(createProject());
    const print = instance("io.print", document);
    createScriptWith(document, print);

    assert.equal(document.project.scripts.length, 1);
    const hat = document.project.scripts[0]!;
    assert.equal(hat.type, "control.start");
    assert.deepEqual(findBlock(document.project, hat.id)?.inputs?.body, [print]);
  });

  it("appends a hat only when it is a start block", () => {
    const document = createDocument(createProject());
    const print = instance("io.print", document);
    assert.equal(appendToScript(document.project, print), false);
    assert.equal(document.project.scripts.length, 0);
  });

  it("removes call blocks when their function definition is deleted", () => {
    const document = createDocument(createProject());
    const definition = createBlock("func.define_value", {
      fields: { name: "twice", params: "x: number", returnType: "number" },
      inputs: { body: [] },
    });
    const callType = `func.call:${definition.id}`;
    const call = createBlock(callType, { inputs: {} });
    const print = createBlock("io.print", { inputs: { text: call } });
    const start = createBlock("control.start", { inputs: { body: [print] } });
    document.project.scripts.push(definition, start);

    assert.equal(removeBlock(document, definition.id), true);
    assert.deepEqual(document.project.scripts.map((node) => node.type), ["control.start"]);
    assert.equal(findBlock(document.project, print.id)?.inputs?.text, undefined);
  });
});
