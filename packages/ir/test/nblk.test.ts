import assert from "node:assert/strict";
import test from "node:test";

import {
  createBlock,
  createDocument,
  createProject,
  FUNCTION_DEFINE_TYPE,
  IMPORT_ALIAS_TYPE,
  IMPORT_ALL_TYPE,
  IMPORT_NAMED_TYPE,
  parseNblk,
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

test("roundtrips variables with all value types", () => {
  const source = `project "Vars"
locale zh-CN

variables:
  n: number = 2.5
  t: text = "a\\"b"
  b: boolean = true
  l: list = ["a", 1, false, [2]]
  d: dict = {"k": 1, "n": [2, 3]}
  e: any = null

start:
  print n
`;
  const document = parseOk(source);
  assert.deepEqual(
    document.project.variables.map((variable) => [variable.name, variable.type]),
    [
      ["n", "number"],
      ["t", "text"],
      ["b", "boolean"],
      ["l", "list"],
      ["d", "dict"],
      ["e", "any"],
    ],
  );
  assert.deepEqual(document.project.variables[3]!.initial, ["a", 1, false, [2]]);
  const printed = printNblk(document);
  assert.match(printed, /l: list = \["a", 1, false, \[2\]\]/);
  assert.match(printed, /d: dict = \{"k": 1, "n": \[2, 3\]\}/);
  assert.equal(printNblk(parseOk(printed)), printed);
});

test("parses control flow", () => {
  const document = parseOk(`project "Flow"

variables:
  score: number = 0
  i: number = 0

start:
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
  const [conditional, repeat, loop, repeatWith, forever] = body(document);
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

variables:
  message: text = ""

start:
  try:
    throw "boom"
  catch:
    print "caught"
  catch text as message:
    print message
`);
  const tryBlock = body(document)[0]!;
  assert.equal(tryBlock.type, "control.try");
  const catchers = tryBlock.inputs?.catches as BlockNode[];
  assert.equal(catchers.length, 2);
  assert.equal(catchers[0]!.type, "control.catch");
  assert.equal(catchers[1]!.type, "control.catchAssign");
  assert.equal(catchers[1]!.fields?.target, document.project.variables[0]!.id);
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

test("declares loop and catch variables on demand", () => {
  const document = parseOk(`project "Auto"

start:
  repeat with i times 2:
    print i
  try:
    throw "boom"
  catch text as message:
    print message
`);
  assert.deepEqual(
    document.project.variables.map((variable) => [variable.name, variable.type]),
    [
      ["i", "number"],
      ["message", "text"],
    ],
  );
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
  const unknownVariable = parseNblk(`project "Bad"\n\nstart:\n  set nope to 1\n`);
  assert.equal(unknownVariable.ok, false);
  if (!unknownVariable.ok) {
    assert.equal(unknownVariable.error.line, 4);
    assert.match(unknownVariable.error.message, /Unknown variable: nope/);
  }

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
