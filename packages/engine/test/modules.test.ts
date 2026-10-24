import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlock,
  createDocument,
  createProject,
  serializeDocument,
  type Project,
} from "@nexus/ir";
import { createLocalHost, memoryStorage } from "../src/host.ts";
import { resolveImports } from "../src/modules.ts";
import { createProjectRegistry } from "../src/registry.ts";
import { runProject } from "../src/run.ts";

function moduleProject(): Project {
  const project = createProject({ name: "lib" });
  project.scripts.push(
    createBlock("func.define", {
      id: "f-answer",
      fields: { name: "answer", params: "", returnType: "number" },
      inputs: {
        body: [
          createBlock("func.return", {
            inputs: { value: createBlock("math.number", { fields: { value: 42 } }) },
          }),
        ],
      },
    }),
    createBlock("func.define", {
      id: "f-greet",
      fields: { name: "greet", params: "who: text", returnType: "text" },
      inputs: {
        body: [
          createBlock("func.return", {
            inputs: { value: createBlock("func.param", { fields: { name: "who" } }) },
          }),
        ],
      },
    }),
  );
  return project;
}

async function hostWith(files: Record<string, string>) {
  const host = createLocalHost(() => {}, memoryStorage());
  for (const [path, text] of Object.entries(files)) {
    await host.invoke({ capability: "fs.write", args: [path, text] });
  }
  return host;
}

function mainProject(imports: ReturnType<typeof createBlock>[]): Project {
  const project = createProject({ name: "main" });
  project.scripts.push(...imports, createBlock("control.start", { inputs: { body: [] } }));
  return project;
}

test("imports every function from a file", async () => {
  const module = createDocument(moduleProject());
  const host = await hostWith({ "lib.json": serializeDocument(module) });
  const project = mainProject([createBlock("import.all", { fields: { file: "lib.json" } })]);

  const resolved = await resolveImports(project, { host });

  assert.deepEqual(resolved.errors, []);
  assert.deepEqual(resolved.files, ["lib.json"]);
  assert.equal(resolved.functionIds.length, 2);
  assert.equal(resolved.project.scripts.filter((node) => node.type === "func.define").length, 2);
});

test("named import only takes the requested function", async () => {
  const module = createDocument(moduleProject());
  const host = await hostWith({ "lib.json": serializeDocument(module) });
  const project = mainProject([
    createBlock("import.named", { fields: { file: "lib.json", name: "greet" } }),
  ]);

  const resolved = await resolveImports(project, { host });

  assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.functionIds.length, 1);
  assert.equal(resolved.project.scripts.filter((node) => node.type === "func.define").length, 1);
});

test("alias renames the imported function for the toolbox", async () => {
  const module = createDocument(moduleProject());
  const host = await hostWith({ "lib.json": serializeDocument(module) });
  const project = mainProject([
    createBlock("import.alias", { fields: { file: "lib.json", name: "greet", alias: "hello" } }),
  ]);

  const resolved = await resolveImports(project, { host });
  const definition = resolved.project.scripts.find((node) => node.type === "func.define");

  assert.equal(definition?.fields?.name, "hello");
  assert.equal(createProjectRegistry(resolved.project).has("func.call:f-greet"), true);
});

test("missing import file becomes a translated error, not a throw", async () => {
  const host = await hostWith({});
  const project = mainProject([createBlock("import.all", { fields: { file: "nope.json" } })]);

  const resolved = await resolveImports(project, { host });

  assert.equal(resolved.errors.length, 1);
  assert.equal(resolved.errors[0]?.messageKey, "runtime.error.fileNotFound");
  assert.equal(resolved.errors[0]?.blockId !== undefined, true);
});

test("missing function is reported", async () => {
  const module = createDocument(moduleProject());
  const host = await hostWith({ "lib.json": serializeDocument(module) });
  const project = mainProject([
    createBlock("import.named", { fields: { file: "lib.json", name: "nope" } }),
  ]);

  const resolved = await resolveImports(project, { host });

  assert.equal(resolved.errors[0]?.messageKey, "runtime.error.importMissingFunction");
  assert.equal(resolved.errors[0]?.params.file, "lib.json");
});

test("transitive imports are merged once", async () => {
  const leaf = createDocument(moduleProject());
  const middle = createDocument(
    (() => {
      const project = createProject({ name: "middle" });
      project.scripts.push(createBlock("import.all", { fields: { file: "leaf.json" } }));
      return project;
    })(),
  );
  const host = await hostWith({
    "leaf.json": serializeDocument(leaf),
    "middle.json": serializeDocument(middle),
  });
  const project = mainProject([createBlock("import.all", { fields: { file: "middle.json" } })]);

  const resolved = await resolveImports(project, { host });

  assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.project.scripts.filter((node) => node.type === "func.define").length, 2);
});

test("imported functions run through a call block", async () => {
  const module = createDocument(moduleProject());
  const host = await hostWith({ "lib.json": serializeDocument(module) });
  const project = createProject({ name: "main" });
  project.scripts.push(
    createBlock("import.all", { fields: { file: "lib.json" } }),
    createBlock("control.start", {
      inputs: {
        body: [
          createBlock("io.print", {
            inputs: { text: createBlock("func.call:f-greet", { fields: { who: "Nexus" } }) },
          }),
        ],
      },
    }),
  );

  const events: string[] = [];
  const result = await runProject(project, {
    host,
    skipImports: false,
    onEvent: (event) => {
      if (event.kind === "log") events.push(event.text);
    },
  });

  assert.equal(result.status, "finished");
  assert.deepEqual(events, ["Nexus"]);
});
