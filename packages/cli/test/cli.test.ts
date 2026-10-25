import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { runCli } from "../src/main.ts";

const dirs: string[] = [];

async function workspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "nblk-cli-"));
  dirs.push(dir);
  return dir;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) } };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("nblk cli", () => {
  it("runs a hello world file and prints to stdout", async () => {
    const dir = await workspace();
    const file = path.join(dir, "hello.nblk");
    await writeFile(file, '开始:\n    打印 "Hello from nblk"\n');
    const { out, io } = capture();
    const code = await runCli([file, "--lang", "en"], io);
    assert.equal(code, 0);
    assert.deepEqual(out, ["Hello from nblk"]);
  });

  it("resolves imports and file capabilities relative to the script", async () => {
    const dir = await workspace();
    await writeFile(
      path.join(dir, "lib.nblk"),
      '定义取值 greet(name):\n    返回 连接("Hello, ", name)\n',
    );
    const file = path.join(dir, "main.nblk");
    await writeFile(
      file,
      [
        '从 "lib.nblk" 导入 greet',
        "开始:",
        '    打印 greet("CLI")',
        '    写入文件("out.txt", "written")',
        '    打印 读取文件("out.txt")',
        "",
      ].join("\n"),
    );
    const { out, io } = capture();
    assert.equal(await runCli([file, "--lang", "en"], io), 0);
    assert.deepEqual(out, ["Hello, CLI", "written"]);
    assert.equal(await readFile(path.join(dir, "out.txt"), "utf8"), "written");
  });

  it("reports syntax errors with a non-zero exit code", async () => {
    const dir = await workspace();
    const file = path.join(dir, "bad.nblk");
    await writeFile(file, "开始:\n  打印(\n");
    const { err, io } = capture();
    const code = await runCli([file, "--lang", "en"], io);
    assert.equal(code, 2);
    assert.match(err.join("\n"), /bad\.nblk:\d+/);
  });

  it("checks a file without running it", async () => {
    const dir = await workspace();
    const file = path.join(dir, "hello.nblk");
    await writeFile(file, '开始:\n    打印 "never printed"\n');
    const { out, io } = capture();
    assert.equal(await runCli(["--check", file, "--lang", "en"], io), 0);
    assert.equal(out.length, 1);
    assert.match(out[0]!, /Parsed successfully/);
  });

  it("prints usage for missing files", async () => {
    const { err, io } = capture();
    assert.equal(await runCli(["--lang", "en"], io), 2);
    assert.match(err[0]!, /No program file given/);
  });

  it("emits JSON events", async () => {
    const dir = await workspace();
    const file = path.join(dir, "json.nblk");
    await writeFile(file, '开始:\n    打印 "json line"\n');
    const { out, io } = capture();
    assert.equal(await runCli([file, "--json", "--lang", "en"], io), 0);
    const events = out.map((line) => JSON.parse(line) as { kind: string });
    assert.ok(events.some((event) => event.kind === "log"));
    assert.equal(events.at(-1)?.kind, "status");
  });
});
