import assert from "node:assert/strict";
import test, { describe, it } from "node:test";

import {
  createBlock,
  createDocument,
  createProject,
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
  const document = parseOk(`项目 "Hello"\n\n开始:\n  打印 "Hi"\n`);
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
  assert.match(first, /打印 "Hello, world!"/);
});

test("roundtrips runtime variable declarations with all value types", () => {
  const source = `项目 "Vars"
语言 zh-CN

开始:
  创建变量 n: number 为 2.5
  创建变量 t: text 为 "a\\"b"
  创建变量 b: boolean 为 true
  创建变量 l: list 为 ["a", 1, false, [2]]
  创建变量 d: dict 为 {"k": 1, "n": [2, 3]}
  创建变量 e 为 null
  打印 n
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
  assert.match(printed, /创建变量 l: 列表 为 \["a", 1, 假, \[2\]\]/);
  assert.match(printed, /创建变量 d: 字典 为 \{"k": 1, "n": \[2, 3\]\}/);
  assert.equal(printNblk(parseOk(printed)), printed);
});

test("rejects the legacy variables section", () => {
  const legacy = parseNblk('项目 "Legacy"\n\nvariables:\n  n: number = 2\n\n开始:\n  打印 "hi"\n');
  assert.equal(legacy.ok, false);
});

test("parses control flow", () => {
  const document = parseOk(`项目 "Flow"

开始:
  创建变量 score: number 为 0
  创建变量 i: number 为 0
  如果 score > 2:
    打印 "big"
  否则如果 score == 2:
    打印 "two"
  否则:
    打印 "small"
  重复 3 次:
    打印 score
  当 score < 5:
    设置 score 为 score + 1
  重复 使用 i 共 2 次:
    打印 i
  无限重复:
    跳出循环
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
  const document = parseOk(`项目 "Funcs"

开始:
  打印 square(3)
  greet("nexus")

定义取值 square(x: number) -> number:
  返回 x * x

定义操作 greet(name: text):
  打印 连接("Hello, ", name)
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
  const document = parseOk(`项目 "Errors"

开始:
  创建变量 message: text 为 ""
  尝试:
    抛出 "boom"
  捕获:
    打印 "caught"
  捕获 文本 作为 message:
    打印 message
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
  const document = parseOk(`项目 "Imports"

导入 "a.nblk"
从 "b.nblk" 导入 greet
从 "c.nblk" 导入 greet 作为 hi

开始:
  打印 "x"
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
  const source = `项目 "Raw"

开始:
  原始 {"type":"future.block","fields":{"value":1},"inputs":{"body":[{"id":"x","type":"io.print","fields":{"text":"ok"}}]}}
`;
  const document = parseOk(source);
  const raw = body(document)[0]!;
  assert.equal(raw.type, "future.block");
  const printed = printNblk(document);
  assert.match(printed, /原始 \{/);
  const again = parseOk(printed);
  assert.equal(body(again)[0]!.type, "future.block");
});

test("keeps loop counters and catch targets as plain names", () => {
  const document = parseOk(`项目 "Auto"

开始:
  重复 使用 i 共 2 次:
    打印 i
  尝试:
    抛出 "boom"
  捕获 文本 作为 message:
    打印 message
`);
  const [repeatWith, tryBlock] = body(document);
  assert.equal(repeatWith!.fields?.variable, "i");
  const catcher = (tryBlock!.inputs?.catches as BlockNode[])[0]!;
  assert.equal(catcher.fields?.target, "message");
});

test("roundtrips raw expression blocks", () => {
  const document = parseOk(`项目 "RawExpr"

开始:
  打印 原始({"id":"x1","type":"future.expr","fields":{"value":1}})
`);
  const print = body(document)[0]!;
  const value = print.inputs?.text as BlockNode;
  assert.equal(value.type, "future.expr");
  const printed = printNblk(document);
  assert.match(printed, /原始\(\{/);
  const again = parseOk(printed);
  assert.equal((body(again)[0]!.inputs?.text as BlockNode).type, "future.expr");
});

test("reports readable errors with line numbers", () => {
  const badIndent = parseNblk(`项目 "Bad"\n\n开始:\n  打印 "a"\n    打印 "b"\n`);
  assert.equal(badIndent.ok, false);
  if (!badIndent.ok) assert.equal(badIndent.error.line, 5);

  const unknownBlock = parseNblk(`项目 "Bad"\n\n开始:\n  未知 1\n`);
  assert.equal(unknownBlock.ok, false);
  if (!unknownBlock.ok) assert.match(unknownBlock.error.message, /Unknown statement/);
});

test("negates numeric literals inline", () => {
  const document = parseOk(`项目 "Neg"\n\n开始:\n  打印 -2\n`);
  const print = body(document)[0]!;
  const value = print.inputs?.text as BlockNode;
  assert.equal(value.type, "math.number");
  assert.equal(value.fields?.value, -2);
});

describe("editor debug metadata", () => {
  it("is preserved by JSON documents but never written into .nblk", () => {
    const document = parseNblk('项目 "meta"\n语言 en\n\n开始:\n  打印 "hi"\n');
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
    `项目 "Jumps"\n\n开始:\n  标记 outer\n  跳转到 outer\n  标记 "with space"\n  跳转到 "with space"\n`,
  );
  const items = body(document);
  assert.equal(items[0]!.type, "control.label");
  assert.equal(items[0]!.fields?.name, "outer");
  assert.equal(items[1]!.type, "control.goto");
  assert.equal(items[2]!.fields?.name, "with space");

  const text = printNblk(document);
  assert.match(text, /^  标记 outer$/m);
  assert.match(text, /^  跳转到 outer$/m);
  assert.match(text, /^  标记 "with space"$/m);

  const again = parseOk(text);
  assert.deepEqual(body(again).map((node) => node.fields?.name), ["outer", "outer", "with space", "with space"]);
});

describe("Chinese keywords", () => {
  test("parses a Chinese-only document", () => {
    const document = parseOk(`项目 "中文项目"
语言 zh-CN

开始:
  创建变量 计数: 数字 为 0
  重复 3 次:
    设置 计数 为 计数 + 1
    打印 计数
  如果 计数 > 2:
    打印 "大"
  否则:
    打印 "小"
  尝试:
    抛出 "boom"
  捕获 文本 作为 消息:
    打印 消息
  注释 "说明"
  退出程序 0
`);
    assert.equal(document.project.name, "中文项目");
    const [create, repeat, ifBlock, tryBlock, note, exit] = body(document);
    assert.equal(create!.type, "var.create");
    assert.equal(create!.fields?.name, "计数");
    assert.equal(create!.fields?.type, "number");
    assert.equal(repeat!.type, "control.repeat");
    assert.equal((repeat!.inputs?.body as BlockNode[])[0]!.type, "var.set");
    assert.equal(ifBlock!.type, "control.if");
    assert.equal(tryBlock!.type, "control.try");
    assert.equal((tryBlock!.inputs?.catches as BlockNode[])[0]!.fields?.target, "消息");
    assert.equal(note!.type, "comment.note");
    assert.equal(exit!.type, "sys.exit");
  });

  test("prints back in Chinese", () => {
    const document = parseOk(`项目 "Out"

开始:
  打印 连接("a", "b")
  创建变量 标志 为 真
`);
    const printed = printNblk(document);
    assert.match(printed, /^项目 "Out"$/m);
    assert.match(printed, /^开始:$/m);
    assert.match(printed, /^  打印 连接\("a", "b"\)$/m);
    assert.match(printed, /^  创建变量 标志 为 真$/m);
    assert.equal(printNblk(parseOk(printed)), printed);
  });

  test("prints function definitions in Chinese", () => {
    const document = parseOk(`项目 "Fn"

定义取值 平方(x: 数字) -> 数字:
  返回 x * x

定义操作 问候(名字: 文本):
  打印 名字
`);
    const printed = printNblk(document);
    assert.match(printed, /^定义取值 平方\(x: 数字\) -> 数字:$/m);
    assert.match(printed, /^定义操作 问候\(名字: 文本\):$/m);
    assert.match(printed, /^  返回 x \* x$/m);
  });

  test("rejects English input", () => {
    const result = parseNblk(`project "Legacy"

start:
  print "hi"
`);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error.message, /中文关键字/);
  });

  test("does not translate keywords inside strings", () => {
    const printed = printNblk(parseOk(`项目 "S"\n\n开始:\n  打印 "如果 真 假 空 连接("\n`));
    assert.match(printed, /打印 "如果 真 假 空 连接\("/);
  });
});
