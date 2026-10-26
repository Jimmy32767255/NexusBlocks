import assert from "node:assert/strict";
import { test } from "node:test";

import { parseNblk } from "@nexus/ir";
import { runProject, type RuntimeEvent } from "../src/index.ts";

async function run(source: string, args: readonly string[] = []) {
  const parsed = parseNblk(source);
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error.message);
  const events: RuntimeEvent[] = [];
  const result = await runProject(parsed.document.project, {
    skipImports: true,
    args,
    onEvent: (event) => events.push(event),
  });
  const logs = events.filter((event) => event.kind === "log").map((event) => (event as { text: string }).text);
  return { result, logs };
}

test("local variables stay inside each recursive call", async () => {
  const { result, logs } = await run(`项目 "Locals"
语言 zh-CN

定义取值 斐波(n: 数字) -> 数字:
  创建局部变量 a 为 0
  创建局部变量 b 为 1
  创建局部变量 i 为 0
  当 i < n:
    创建局部变量 t 为 a + b
    设置局部变量 a 为 b
    设置局部变量 b 为 t
    设置局部变量 i 为 i + 1
  返回 a

开始:
  创建变量 a 为 "global"
  打印 斐波(10)
  打印 a
`);
  assert.equal(result.status, "finished");
  assert.deepEqual(logs, ["55", "global"]);
});

test("local variables only exist inside a function", async () => {
  const outside = await run(`项目 "Outside"
语言 zh-CN

开始:
  创建局部变量 x 为 1
`);
  assert.equal(outside.result.status, "error");
  assert.equal(outside.result.error?.messageKey, "runtime.error.localOutsideFunction");

  const missing = await run(`项目 "Missing"
语言 zh-CN

定义操作 f():
  设置局部变量 y 为 1

开始:
  f()
`);
  assert.equal(missing.result.status, "error");
  assert.equal(missing.result.error?.messageKey, "runtime.error.missingVariable");
});

test("and / or short-circuit", async () => {
  const { result, logs } = await run(`项目 "Short"
语言 zh-CN

定义取值 计数() -> 布尔值:
  设置 g 为 g + 1
  返回 真

开始:
  创建变量 g 为 0
  打印 真 或者 计数()
  打印 假 并且 计数()
  打印 g
`);
  assert.equal(result.status, "finished");
  assert.deepEqual(logs.slice(-1), ["0"]);
});

test("for each walks a list and honours break", async () => {
  const { result, logs } = await run(`项目 "Each"
语言 zh-CN

开始:
  创建变量 xs 为 [1, 2, 3, 4]
  创建变量 total 为 0
  对每项 x 在 xs:
    如果 x == 3:
      跳出循环
    设置 total 为 total + x
  打印 total
`);
  assert.equal(result.status, "finished");
  assert.deepEqual(logs, ["3"]);
});

test("removing a list item shifts later items", async () => {
  const { logs } = await run(`项目 "Remove"
语言 zh-CN

开始:
  创建变量 xs 为 [1, 2, 3]
  移除(xs, 0)
  打印 xs
`);
  assert.deepEqual(logs, ["[2, 3]"]);
});

test("parse JSON from text", async () => {
  const { logs } = await run(String.raw`项目 "Json"
语言 zh-CN

开始:
  创建变量 data 为 解析JSON("{\"a\": [1, 2]}")
  打印 data["a"][1]
`);
  assert.deepEqual(logs, ["2"]);

  const broken = await run(`项目 "Broken"
语言 zh-CN

开始:
  打印 解析JSON("{oops}")
`);
  assert.equal(broken.result.status, "error");
  assert.equal(broken.result.error?.messageKey, "runtime.error.badJson");
});

test("program arguments are visible as a list", async () => {
  const { logs } = await run(`项目 "Args"
语言 zh-CN

开始:
  打印 参数()
  打印 长度(参数())
`, ["alpha", "beta"]);
  assert.deepEqual(logs, ["[alpha, beta]", "2"]);
});
