import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import {
  createBlock,
  createDocument,
  createProject,
  FUNCTION_DEFINE_TYPE,
  IMPORT_ALIAS_TYPE,
  IMPORT_ALL_TYPE,
  IMPORT_NAMED_TYPE,
  parseNblk,
  parseDocument,
  printNblk,
  type BlockNode,
  type NexusDocument,
} from "@nexus/ir";

function parseOk(source: string): NexusDocument {
  const parsed = parseNblk(source);
  assert.equal(parsed.ok, true, parsed.ok ? "" : `${parsed.error.line}: ${parsed.error.message}`);
  return parsed.document;
}

function body(document: NexusDocument, index = 0): BlockNode[] {
  return (document.project.scripts[index]?.inputs?.body as BlockNode[]) ?? [];
}

test("parses hello world", () => {
  const document = parseOk(`project "Hello"\n\nstart:\n  print "Hi"\n`);
  assert.equal(document.project.name, "Hello");
  assert.equal(document.project.scripts.length, 1);
  assert.equal(document.project.scripts[0]!.type, "control.start");
  assert.equal(body(document)[0]!.type, "io.print");
  assert.equal(body(document)[0]!.fields?.text, "Hi");
});

test("prints and reparses a document idempotently", () => {
  const document = createDocument(createProject({ name: "Hello" }));
  document.project.scripts.push(
    createBlock("control.start", {
      inputs: { body: [createBlock("io.print", { fields: { text: "Hello, world!" } })] },
    }),
  );
  const first = printNblk(document);
  const second = printNblk(parseOk(first));
  assert.equal(second, first);
  assert.match(first, /print "Hello, world!"/);
});

test("roundtrips runtime variable declarations with all value types", () => {
  const source = `project "Vars"
locale zh-CN

start:
  create n: number as 2.5
  create t: text as "a\\"b"
  create b: boolean as true
  create l: list as ["a", 1, false, [2]]
  create d: dict as {"k": 1, "n": [2, 3]}
  create e as null
  print n
`;
  const document = parseOk(source);
  const body = (document.project.scripts[0]!.inputs!.body as BlockNode[]);
  assert.deepEqual(
    body.slice(0, 6).map((node) => [node.fields?.name, node.fields?.type]),
    [
      ["n", "number"],
      ["t", "text"],
      ["b", "boolean"],
      ["l", "list"],
      ["d", "dict"],
      ["e", "any"],
    ],
  );
  const printed = printNblk(document);
  assert.match(printed, /create l: list as \["a", 1, false, \[2\]\]/);
  assert.match(printed, /create d: dict as \{"k": 1, "n": \[2, 3\]\}/);
  assert.equal(printNblk(parseOk(printed)), printed);
});

test("drops the legacy variables section with a warning", () => {
  const result = parseNblk(`project "Legacy"

variables:
  n: number = 2

start:
  print "hi"
`);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.document.project.scripts.length, 1);
  assert.equal(result.warnings.length, 1);
});

test("parses control flow", () => {
  const document = parseOk(`project "Flow"

start:
  create score: number as 0
  create i: number as 0
  if score > 2:
    print "big"
  else if score == 2:
    print "two"
  else:
    print "small"
  repeat 3:
    print score
  while score < 5:
    set score to score + 1
  repeat with i times 2:
    print i
  forever:
    break
`);
  const [, , conditional, repeat, loop, repeatWith, forever] = body(document);
  assert.equal(conditional!.type, "control.if");
  assert.ok(conditional!.inputs?.elseIf1);
  assert.ok(conditional!.inputs?.else);
  assert.equal(conditional!.fields?.condition, undefined);
  assert.equal(repeat!.type, "control.repeat");
  assert.equal(loop!.type, "control.while");
  assert.equal(repeatWith!.type, "control.repeatWith");
  assert.equal(forever!.type, "control.forever");
  assert.equal((forever!.inputs?.body as BlockNode[])[0]!.type, "control.break");
});

test("parses functions, calls and returns", () => {
  const document = parseOk(`project "Funcs"

start:
  print square(3)
  greet("nexus")

define value square(x: number) -> number:
  return x * x

define action greet(name: text):
  print join("Hello, ", name)
`);
  const startBody = body(document);
  assert.equal(startBody[0]!.type, "io.print");
  assert.match(String((startBody[0]!.inputs?.text as BlockNode).type), /^func\.call:/);
  const callStatement = startBody[1]!;
  assert.match(callStatement.type, /^func\.call:/);
  const definition = document.project.scripts[1]!;
  assert.equal(definition.type, "func.define_value");
  assert.equal(definition.fields?.params, "x: number");
  assert.equal(definition.fields?.returnType, "number");
  assert.equal(((definition.inputs?.body as BlockNode[]) ?? [])[0]!.type, "func.return");
  const greet = document.project.scripts[2]!;
  assert.equal(greet.type, "func.define_action");
});

test("parses try/catch forms", () => {
  const document = parseOk(`project "Errors"

start:
  create message: text as ""
  try:
    throw "boom"
  catch:
    print "caught"
  catch text as message:
    print message
`);
  const tryBlock = body(document)[1]!;
  assert.equal(tryBlock.type, "control.try");
  const catchers = tryBlock.inputs?.catches as BlockNode[];
  assert.equal(catchers.length, 2);
  assert.equal(catchers[0]!.type, "control.catch");
  assert.equal(catchers[1]!.type, "control.catchAssign");
  assert.equal(catchers[1]!.fields?.target, "message");
});

test("parses the three import forms", () => {
  const document = parseOk(`project "Imports"

import "a.nblk"
from "b.nblk" import greet
from "c.nblk" import greet as hi

start:
  print "x"
`);
  const imports = document.project.scripts.slice(0, 3);
  assert.deepEqual(
    imports.map((node) => node.type),
    [IMPORT_ALL_TYPE, IMPORT_NAMED_TYPE, IMPORT_ALIAS_TYPE],
  );
  assert.equal(imports[1]!.fields?.name, "greet");
  assert.equal(imports[2]!.fields?.alias, "hi");
});

test("falls back to raw blocks and reparses them", () => {
  const source = `project "Raw"

start:
  raw {"type":"future.block","fields":{"value":1},"inputs":{"body":[{"id":"x","type":"io.print","fields":{"text":"ok"}}]}}
`;
  const document = parseOk(source);
  const raw = body(document)[0]!;
  assert.equal(raw.type, "future.block");
  const printed = printNblk(document);
  assert.match(printed, /raw \{/);
  const again = parseOk(printed);
  assert.equal(body(again)[0]!.type, "future.block");
});

test("keeps loop counters and catch targets as plain names", () => {
  const document = parseOk(`project "Auto"

start:
  repeat with i times 2:
    print i
  try:
    throw "boom"
  catch text as message:
    print message
`);
  const [repeatWith, tryBlock] = body(document);
  assert.equal(repeatWith!.fields?.variable, "i");
  const catcher = (tryBlock!.inputs?.catches as BlockNode[])[0]!;
  assert.equal(catcher.fields?.target, "message");
});

test("roundtrips raw expression blocks", () => {
  const document = parseOk(`project "RawExpr"

start:
  print raw({"id":"x1","type":"future.expr","fields":{"value":1}})
`);
  const print = body(document)[0]!;
  const value = print.inputs?.text as BlockNode;
  assert.equal(value.type, "future.expr");
  const printed = printNblk(document);
  assert.match(printed, /raw\(\{/);
  const again = parseOk(printed);
  assert.equal((body(again)[0]!.inputs?.text as BlockNode).type, "future.expr");
});

test("reports readable errors with line numbers", () => {
  const badIndent = parseNblk(`project "Bad"\n\nstart:\n  print "a"\n    print "b"\n`);
  assert.equal(badIndent.ok, false);
  if (!badIndent.ok) assert.equal(badIndent.error.line, 5);

  const unknownBlock = parseNblk(`project "Bad"\n\nstart:\n  whatever 1\n`);
  assert.equal(unknownBlock.ok, false);
  if (!unknownBlock.ok) assert.match(unknownBlock.error.message, /Unknown statement/);
});

test("negates numeric literals inline", () => {
  const document = parseOk(`project "Neg"\n\nstart:\n  print -2\n`);
  const print = body(document)[0]!;
  const value = print.inputs?.text as BlockNode;
  assert.equal(value.type, "math.number");
  assert.equal(value.fields?.value, -2);
});

describe("editor debug metadata", () => {
  it("is preserved by JSON documents but never written into .nblk", () => {
    const document = parseNblk('project "meta"\nlocale en\n\nstart:\n  print "hi"\n');
    assert.equal(document.ok, true);
    if (!document.ok) return;
    document.document.debug = { breakpoints: [document.document.project.scripts[0]!.id] };
    const text = printNblk(document.document);
    assert.equal(text.includes("breakpoint"), false);
    assert.equal(text.includes("debug"), false);

    const reloaded = parseDocument(JSON.stringify(document.document));
    assert.equal(reloaded.ok, true);
    if (!reloaded.ok) return;
    assert.deepEqual(reloaded.document.debug?.breakpoints, document.document.debug.breakpoints);
  });
});

test("parses and prints label / goto names", () => {
  const document = parseOk(
    `project "Jumps"\n\nstart:\n  label outer\n  goto outer\n  label "with space"\n  goto "with space"\n`,
  );
  const items = body(document);
  assert.equal(items[0]!.type, "control.label");
  assert.equal(items[0]!.fields?.name, "outer");
  assert.equal(items[1]!.type, "control.goto");
  assert.equal(items[2]!.fields?.name, "with space");

  const text = printNblk(document);
  assert.match(text, /^  label outer$/m);
  assert.match(text, /^  goto outer$/m);
  assert.match(text, /^  label "with space"$/m);

  const again = parseOk(text);
  assert.deepEqual(body(again).map((node) => node.fields?.name), ["outer", "outer", "with space", "with space"]);
});
