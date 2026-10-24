import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlock,
  createDocument,
  createHelloWorldScript,
  createProject,
  errorsOnly,
  parseDocument,
  serializeDocument,
  validateProject,
  type BlockSchema,
} from "../src/index.ts";

const schemas = {
  get(type: string): BlockSchema | undefined {
    if (type === "control.start") {
      return {
        type,
        kind: "hat",
        category: "control",
        label: "x",
        output: "void",
        fields: [],
        ports: [{ name: "body", label: "body", kind: "stack" }],
      };
    }
    if (type === "io.print") {
      return {
        type,
        kind: "statement",
        category: "io",
        label: "x",
        output: "void",
        fields: [],
        ports: [{ name: "text", label: "text", kind: "value", type: "any" }],
      };
    }
    if (type === "text.literal") {
      return {
        type,
        kind: "expression",
        category: "text",
        label: "x",
        output: "text",
        fields: [{ name: "value", kind: "text", label: "x", default: "" }],
        ports: [],
      };
    }
    return undefined;
  },
};

test("document serialisation round-trips without loss", () => {
  const project = createProject({ name: "Round trip", locale: "en" });
  project.scripts = [createHelloWorldScript()];
  const document = createDocument(project);

  const encoded = serializeDocument(document);
  assert.equal(encoded.includes('"editor"'), false);
  const parsed = parseDocument(encoded);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.document, document);
});

test("drops the old canvas layout when loading version 1", () => {
  const legacy = {
    format: "nexus-blocks/document",
    version: 1,
    project: createProject(),
    editor: { positions: { a: { x: 1, y: 2 } }, viewport: { x: 3, y: 4, zoom: 1 } },
  };
  const parsed = parseDocument(legacy);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.version, 2);
  assert.equal("editor" in parsed.document, false);
  assert.ok(parsed.warnings.length > 0);
});

test("parse rejects documents from another format", () => {
  const result = parseDocument({ format: "something-else" });
  assert.equal(result.ok, false);
});

test("a hello world program validates cleanly", () => {
  const project = createProject();
  project.scripts = [createHelloWorldScript()];
  assert.deepEqual(errorsOnly(validateProject(project, schemas)), []);
});

test("top-level statements are rejected by validation", () => {
  const project = createProject();
  project.scripts = [createBlock("io.print", { fields: { text: "no hat" } })];
  const errors = errorsOnly(validateProject(project, schemas));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, "block.kindMismatch");
});

test("unknown blocks are reported, not thrown", () => {
  const project = createProject();
  project.scripts = [
    createBlock("control.start", { inputs: { body: [createBlock("nope.nothing")] } }),
  ];
  const errors = errorsOnly(validateProject(project, schemas));
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, "block.unknownType");
});
