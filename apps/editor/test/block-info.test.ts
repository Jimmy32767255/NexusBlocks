import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { defaultRegistry } from "@nexus/engine";
import { createFunctionCallSchema, type FunctionDecl } from "@nexus/ir";

const dom = new JSDOM("<!doctype html><html lang=\"zh-CN\"><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  getComputedStyle: dom.window.getComputedStyle,
});

dom.window.localStorage.setItem("nexus-blocks:locale", "zh-CN");

const { describeBlock, renderBlockDetails } = await import("../src/block-info.ts");

function schema(type: string) {
  const definition = defaultRegistry.get(type);
  assert.ok(definition, `missing ${type}`);
  return definition;
}

describe("block details", () => {
  it("describes a value block", () => {
    const info = describeBlock(schema("text.join"));
    assert.equal(info.kind, "expression");
    assert.equal(info.subtype, "none");
    assert.equal(info.hasStack, false);
    assert.equal(info.extensible, true);
    assert.equal(info.desktopOnly, false);
    assert.equal(info.returnType, "text");
    assert.deepEqual(
      info.params.map((param) => param.type),
      ["text", "text"],
    );
  });

  it("describes a hat and a terminal statement", () => {
    const hat = describeBlock(schema("control.start"));
    assert.equal(hat.kind, "action");
    assert.equal(hat.subtype, "hat");
    assert.equal(hat.hasStack, true);

    const terminal = describeBlock(schema("sys.exit"));
    assert.equal(terminal.subtype, "terminal");
    assert.equal(terminal.hasStack, false);
    assert.equal(terminal.returnType, null);
  });

  it("marks desktop-only blocks", () => {
    assert.equal(describeBlock(schema("os.exec_command")).desktopOnly, true);
    assert.equal(describeBlock(schema("io.print")).desktopOnly, false);
  });

  it("describes a function call block from its declaration", () => {
    const decl: FunctionDecl = {
      id: "f1",
      kind: "value",
      name: "greet",
      params: [{ name: "who", type: "text" }],
      returnType: "text",
      node: { id: "d1", type: "func.define", inputs: { body: [] } },
    };
    const callSchema = createFunctionCallSchema(decl);
    const info = describeBlock(callSchema);
    assert.equal(info.kind, "expression");
    assert.deepEqual(info.params, [{ name: "who", type: "text" }]);
    assert.equal(info.returnType, "text");
    assert.equal(info.extensible, false);
  });

  it("renders every detail row and the parameter table", () => {
    const body = renderBlockDetails(schema("control.start"));
    const labels = [...body.querySelectorAll(".block-detail__label")].map((node) => node.textContent);
    assert.deepEqual(labels, [
      "语句类型",
      "语句子类型",
      "支持的操作系统",
      "C 形积木",
      "可扩展",
      "接受参数",
      "返回值类型",
    ]);
    const values = [...body.querySelectorAll(".block-detail__value")].map((node) => node.textContent);
    assert.deepEqual(values, ["操作", "帽子", "任意", "是", "否", "0 个", "无"]);

    const cells = [...body.querySelectorAll(".block-detail__params td")].map((node) => node.textContent);
    assert.deepEqual(cells, ["无"]);
  });

  it("lists parameter names and accepted types in the table", () => {
    const body = renderBlockDetails(schema("text.join"));
    const rows = [...body.querySelectorAll(".block-detail__params tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0]?.[1], "文本");
    assert.equal(body.querySelector("caption")?.textContent, "形式参数列表");
  });
});
