import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlock,
  createProject,
  functionCallType,
  type BlockNode,
  type Project,
} from "@nexus/ir";
import {
  BlockRegistry,
  coreBlocks,
  createHelloWorldProject,
  defaultRegistry,
  runProject,
  OS_CAPABILITIES,
  type BlockDefinition,
  type HostBridge,
  type RuntimeEvent,
} from "../src/index.ts";
import { en, zhCN } from "@nexus/i18n";

function start(body: BlockNode[]): BlockNode {
  return createBlock("control.start", { inputs: { body } });
}

/** `create variable` statement used to declare a variable at run time. */
function declare(name: string, type: string, value: BlockNode): BlockNode {
  return createBlock("var.create", { fields: { name, type }, inputs: { value } });
}

function text(value: string): BlockNode {
  return createBlock("text.literal", { fields: { value } });
}

function projectWith(...scripts: BlockNode[]): Project {
  const project = createProject();
  project.scripts = scripts;
  return project;
}

function loggedTexts(events: RuntimeEvent[]): string[] {
  return events.filter((event) => event.kind === "log").map((event) => (event as { text: string }).text);
}

test("hello world prints exactly one line", async () => {
  const events: RuntimeEvent[] = [];
  const result = await runProject(createHelloWorldProject("en"), { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["Hello, world!"]);
});

test("variables and arithmetic feed text.join", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("total", "number", createBlock("math.number", { fields: { value: 0 } })),
      createBlock("var.set", {
        fields: { variable: "total" },
        inputs: {
          value: createBlock("math.arithmetic", {
            fields: { op: "+" },
            inputs: {
              a: createBlock("math.number", { fields: { value: 1 } }),
              b: createBlock("math.number", { fields: { value: 2 } }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.join", {
            inputs: {
              a: createBlock("text.literal", { fields: { value: "total=" } }),
              b: createBlock("var.get", { fields: { variable: "total" } }),
            },
          }),
        },
      }),
    ]),
  ];

  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["total=3"]);
});

test("repeat runs its body the requested number of times", async () => {
  const project = projectWith(
    start([
      createBlock("control.repeat", {
        inputs: {
          times: createBlock("math.number", { fields: { value: 3 } }),
          body: [createBlock("io.print", { fields: { text: "hi" } })],
        },
      }),
    ]),
  );

  const events: RuntimeEvent[] = [];
  await runProject(project, { onEvent: (event) => events.push(event) });
  assert.deepEqual(loggedTexts(events), ["hi", "hi", "hi"]);
});

test("if/else picks a branch from a comparison", async () => {
  const project = projectWith(
    start([
      createBlock("control.if", {
        inputs: {
          condition: createBlock("logic.compare", {
            fields: { op: ">=" },
            inputs: {
              a: createBlock("math.number", { fields: { value: 2 } }),
              b: createBlock("math.number", { fields: { value: 3 } }),
            },
          }),
          then: [createBlock("io.print", { fields: { text: "yes" } })],
          else: [createBlock("io.print", { fields: { text: "no" } })],
        },
      }),
    ]),
  );

  const events: RuntimeEvent[] = [];
  await runProject(project, { onEvent: (event) => events.push(event) });
  assert.deepEqual(loggedTexts(events), ["no"]);
});

test("division by zero reports a translatable error", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("math.arithmetic", {
            fields: { op: "/" },
            inputs: {
              a: createBlock("math.number", { fields: { value: 1 } }),
              b: createBlock("math.number", { fields: { value: 0 } }),
            },
          }),
        },
      }),
    ]),
  );

  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.divisionByZero");
});

test("aborting the signal stops the program", async () => {
  const project = projectWith(
    start([
      createBlock("control.repeat", {
        inputs: {
          times: createBlock("math.number", { fields: { value: 10_000 } }),
          body: [createBlock("io.print", { fields: { text: "tick" } })],
        },
      }),
    ]),
  );

  const controller = new AbortController();
  const logs: string[] = [];
  const result = await runProject(project, {
    signal: controller.signal,
    onEvent: (event) => {
      if (event.kind === "log") {
        logs.push(event.text);
        if (logs.length === 1) controller.abort();
      }
    },
  });

  assert.equal(result.status, "stopped");
  assert.equal(logs.length, 1);
});

test("invalid programs fail before executing", async () => {
  const project = createProject();
  project.scripts = [createBlock("io.print", { fields: { text: "naked" } })];
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "diag.block.kindMismatch");
});

test("empty projects finish immediately", async () => {
  const result = await runProject(createProject());
  assert.equal(result.status, "finished");
  assert.equal(result.steps, 0);
});

test("hosts can extend the language without touching the interpreter", async () => {
  const ping: BlockDefinition = {
    type: "test.ping",
    kind: "expression",
    category: "io",
    label: "test.ping",
    output: "text",
    color: "#000000",
    fields: [],
    ports: [],
    async evaluate(ctx) {
      return ctx.host.invoke({ capability: "test.ping", args: [] });
    },
  };
  const registry = new BlockRegistry([...coreBlocks, ping]);
  const host = {
    name: "test",
    capabilities: () => [],
    async invoke(request: { capability: string }) {
      return `pong:${request.capability}`;
    },
  };

  const project = projectWith(
    start([createBlock("io.print", { inputs: { text: createBlock("test.ping") } })]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, {
    registry,
    host,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["pong:test.ping"]);
});

test("every block string is translated in English and Chinese", () => {
  for (const definition of defaultRegistry.all()) {
    const keys = [
      definition.label,
      definition.description ?? "",
      ...definition.fields.map((field) => field.label),
      ...definition.ports.map((port) => port.label),
    ].filter(Boolean);
    for (const key of keys) {
      assert.ok(key in en, `missing en: ${key}`);
      assert.ok(key in zhCN, `missing zh-CN: ${key}`);
    }
  }
});

test("wait pauses the program for the requested duration", async () => {
  const events: RuntimeEvent[] = [];
  const project = projectWith(
    start([
      createBlock("control.wait", { inputs: { seconds: createBlock("math.number", { fields: { value: 0.03 } }) } }),
      createBlock("io.print", { fields: { text: "done" } }),
    ]),
  );
  const started = Date.now();
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.ok(Date.now() - started >= 25);
  assert.deepEqual(loggedTexts(events), ["done"]);
});

test("stopping the program interrupts a wait immediately", async () => {
  const controller = new AbortController();
  const project = projectWith(
    start([
      createBlock("control.wait", { inputs: { seconds: createBlock("math.number", { fields: { value: 5 } }) } }),
    ]),
  );
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  const result = await runProject(project, { signal: controller.signal });
  assert.equal(result.status, "stopped");
  assert.ok(Date.now() - started < 1000);
});

test("lists can be read, extended and measured", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("items", "list", createBlock("list.literal", { fields: { items: "[1,2]" } })),
      createBlock("list.add", {
        inputs: {
          items: createBlock("var.get", { fields: { variable: "items" } }),
          value: createBlock("math.number", { fields: { value: 3 } }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("list.get", {
            inputs: {
              items: createBlock("var.get", { fields: { variable: "items" } }),
              index: createBlock("math.number", { fields: { value: 1 } }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("list.length", {
            inputs: { items: createBlock("var.get", { fields: { variable: "items" } }) },
          }),
        },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["2", "3"]);
});

test("list access reports an out-of-range index", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("items", "list", createBlock("list.literal", { fields: { items: "[1]" } })),
      createBlock("io.print", {
        inputs: {
          text: createBlock("list.get", {
            inputs: {
              items: createBlock("var.get", { fields: { variable: "items" } }),
              index: createBlock("math.number", { fields: { value: 4 } }),
            },
          }),
        },
      }),
    ]),
  ];
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.badIndex");
});

test("dictionaries support get, has, keys and set", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("person", "dict", createBlock("dict.literal", { fields: { items: '{"name":"Ada"}' } })),
      createBlock("dict.set", {
        inputs: {
          dict: createBlock("var.get", { fields: { variable: "person" } }),
          key: createBlock("text.literal", { fields: { value: "age" } }),
          value: createBlock("math.number", { fields: { value: 42 } }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("dict.get", {
            inputs: {
              dict: createBlock("var.get", { fields: { variable: "person" } }),
              key: createBlock("text.literal", { fields: { value: "name" } }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("dict.has", {
            inputs: {
              dict: createBlock("var.get", { fields: { variable: "person" } }),
              key: createBlock("text.literal", { fields: { value: "age" } }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.join", {
            inputs: { a: createBlock("dict.keys", { inputs: { dict: createBlock("var.get", { fields: { variable: "person" } }) } }) },
          }),
        },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["Ada", "true", "[name, age]"]);
});

function defineFunction(
  name: string,
  params: string,
  returnType: string,
  body: BlockNode[],
): BlockNode {
  return createBlock(returnType === "void" ? "func.define_action" : "func.define_value", {
    fields: { name, params, returnType },
    inputs: { body },
  });
}

function callFunctionBlock(definition: BlockNode, inputs: Record<string, BlockNode> = {}): BlockNode {
  return createBlock(functionCallType(definition.id), { inputs });
}

test("functions receive arguments and return values", async () => {
  const square = defineFunction("square", "x: number", "number", [
    createBlock("func.return", {
      inputs: {
        value: createBlock("math.arithmetic", {
          fields: { op: "*" },
          inputs: {
            a: createBlock("func.param", { fields: { name: "x" } }),
            b: createBlock("func.param", { fields: { name: "x" } }),
          },
        }),
      },
    }),
  ]);
  const project = projectWith(
    square,
    start([
      createBlock("io.print", {
        inputs: {
          text: callFunctionBlock(square, { x: createBlock("math.number", { fields: { value: 5 } }) }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["25"]);
});

test("a function definition never runs by itself", async () => {
  const noop = defineFunction("noop", "", "void", [
    createBlock("io.print", { fields: { text: "inside" } }),
  ]);
  const project = projectWith(
    noop,
    start([createBlock("io.print", { fields: { text: "main" } })]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["main"]);
});

test("parameter blocks outside their function are rejected", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: { text: createBlock("func.param", { fields: { name: "x" } }) },
      }),
    ]),
  );
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "diag.function.unknownParam");
});

test("break leaves the innermost loop", async () => {
  const project = projectWith(
    start([
      createBlock("control.repeat", {
        inputs: {
          times: createBlock("math.number", { fields: { value: 10 } }),
          body: [
            createBlock("io.print", { fields: { text: "once" } }),
            createBlock("control.break"),
          ],
        },
      }),
      createBlock("io.print", { fields: { text: "after" } }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["once", "after"]);
});

test("break outside a loop is a runtime error", async () => {
  const project = projectWith(start([createBlock("control.break")]));
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.breakOutsideLoop");
});

test("forever repeats until a break leaves the loop", async () => {
  const project = projectWith(
    start([
      createBlock("control.forever", {
        inputs: {
          body: [createBlock("io.print", { fields: { text: "tick" } }), createBlock("control.break")],
        },
      }),
      createBlock("io.print", { fields: { text: "after" } }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["tick", "after"]);
});

test("while checks the condition before every round", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("i", "number", createBlock("math.number", { fields: { value: 0 } })),
      createBlock("control.while", {
        inputs: {
          condition: createBlock("logic.compare", {
            fields: { op: "<" },
            inputs: {
              a: createBlock("var.get", { fields: { variable: "i" } }),
              b: createBlock("math.number", { fields: { value: 3 } }),
            },
          }),
          body: [
            createBlock("io.print", {
              inputs: { text: createBlock("var.get", { fields: { variable: "i" } }) },
            }),
            createBlock("var.set", {
              fields: { variable: "i" },
              inputs: {
                value: createBlock("math.arithmetic", {
                  fields: { op: "+" },
                  inputs: {
                    a: createBlock("var.get", { fields: { variable: "i" } }),
                    b: createBlock("math.number", { fields: { value: 1 } }),
                  },
                }),
              },
            }),
          ],
        },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["0", "1", "2"]);
});

test("repeat with counter stores 0..n-1 in the chosen variable", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("round", "number", createBlock("math.number", { fields: { value: 0 } })),
      createBlock("control.repeatWith", {
        fields: { variable: "round" },
        inputs: {
          times: createBlock("math.number", { fields: { value: 3 } }),
          body: [
            createBlock("io.print", {
              inputs: { text: createBlock("var.get", { fields: { variable: "round" } }) },
            }),
          ],
        },
      }),
      createBlock("io.print", {
        inputs: { text: createBlock("var.get", { fields: { variable: "round" } }) },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["0", "1", "2", "2"]);
});

test("break leaves a repeat with counter loop", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("round", "number", createBlock("math.number", { fields: { value: 0 } })),
      createBlock("control.repeatWith", {
        fields: { variable: "round" },
        inputs: {
          times: createBlock("math.number", { fields: { value: 5 } }),
          body: [createBlock("io.print", { fields: { text: "once" } }), createBlock("control.break")],
        },
      }),
      createBlock("io.print", { fields: { text: "after" } }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["once", "after"]);
});

test("pass does nothing and execution continues", async () => {
  const project = projectWith(start([createBlock("control.pass"), createBlock("io.print", { fields: { text: "ok" } })]));
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["ok"]);
});

test("comments never change program output or state", async () => {
  const project = projectWith(
    start([
      createBlock("comment.note", { fields: { text: "explain the next line" } }),
      createBlock("io.print", { fields: { text: "ok" } }),
      createBlock("comment.note", { fields: { text: "" } }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["ok"]);
});

test("comments can hold arbitrary text without failing validation", async () => {
  const project = projectWith(
    start([createBlock("comment.note", { fields: { text: "含中文 / with symbols #{}" } })]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), []);
});

test("every category has a toolbox label", () => {
  for (const { category } of defaultRegistry.grouped()) {
    const key = `category.${category}`;
    assert.ok(key in en, `missing en: ${key}`);
    assert.ok(key in zhCN, `missing zh-CN: ${key}`);
  }
});

test("exit with status 0 finishes the run immediately", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", { fields: { text: "before" } }),
      createBlock("sys.exit", { inputs: { code: createBlock("math.number", { fields: { value: 0 } }) } }),
      createBlock("io.print", { fields: { text: "after" } }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["before"]);
});

test("exit with a non-zero status ends the run with that code", async () => {
  const project = projectWith(
    start([
      createBlock("sys.exit", { inputs: { code: createBlock("math.number", { fields: { value: 3 } }) } }),
      createBlock("io.print", { fields: { text: "after" } }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.exitCode");
  assert.deepEqual(result.error?.params, { code: 3 });
  assert.deepEqual(loggedTexts(events), []);
});

test("exit is not swallowed by try/catch", async () => {
  const project = createProject();
  project.scripts = [
    start([
      declare("message", "text", text("")),
      createBlock("control.try", {
        inputs: {
          body: [createBlock("sys.exit", { inputs: { code: createBlock("math.number", { fields: { value: 0 } }) } })],
          catches: [
            createBlock("control.catchAssign", {
              fields: { exception: "any", target: "message" },
              inputs: { body: [createBlock("io.print", { fields: { text: "caught" } })] },
            }),
          ],
        },
      }),
    ]),
  ];
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), []);
});

test("convert text to number parses the whole numeric string", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toNumber", {
            inputs: { text: createBlock("text.literal", { fields: { value: "  -12.5 " } }) },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["-12.5"]);
});

test("convert text to number rejects mixed content", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toNumber", {
            inputs: { text: createBlock("text.literal", { fields: { value: "12abc" } }) },
          }),
        },
      }),
    ]),
  );
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.toNumber");
  assert.deepEqual(result.error?.params, { value: "12abc" });
});

test("convert number to text keeps the decimal spelling", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: { value: createBlock("math.number", { fields: { value: 123 } }) },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["123"]);
});

test("text.join grows to the requested number of inputs", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.join", {
            fields: { count: 3 },
            inputs: {
              a: createBlock("text.literal", { fields: { value: "a" } }),
              b: createBlock("text.literal", { fields: { value: "b" } }),
              c: createBlock("text.literal", { fields: { value: "c" } }),
            },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["abc"]);
});

test("if blocks run the matching else-if branch", async () => {
  const project = projectWith(
    start([
      createBlock("control.if", {
        fields: { elseIfs: 3 },
        inputs: {
          condition: createBlock("logic.boolean", { fields: { value: false } }),
          elseIf1: createBlock("logic.boolean", { fields: { value: false } }),
          elseIf2: createBlock("logic.boolean", { fields: { value: true } }),
          elseIf2Body: [createBlock("io.print", { fields: { text: "two" } })],
          then: [createBlock("io.print", { fields: { text: "then" } })],
          else: [createBlock("io.print", { fields: { text: "else" } })],
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["two"]);
});

test("text.splitAt returns the requested piece", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.splitAt", {
            inputs: {
              text: createBlock("text.literal", { fields: { value: "a,b,c" } }),
              separator: createBlock("text.literal", { fields: { value: "," } }),
              index: createBlock("math.number", { fields: { value: 1 } }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.contains", {
            inputs: {
              text: createBlock("text.literal", { fields: { value: "hello" } }),
              needle: createBlock("text.literal", { fields: { value: "ell" } }),
            },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["b", "true"]);
});

test("text.splitAt rejects empty separators and missing pieces", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.splitAt", {
            fields: { separator: "", index: 0 },
            inputs: { text: createBlock("text.literal", { fields: { value: "abc" } }) },
          }),
        },
      }),
    ]),
  );
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.splitSeparator");

  const outOfRange = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.splitAt", {
            fields: { separator: ",", index: 9 },
            inputs: { text: createBlock("text.literal", { fields: { value: "a,b" } }) },
          }),
        },
      }),
    ]),
  );
  const second = await runProject(outOfRange);
  assert.equal(second.status, "error");
  assert.equal(second.error?.messageKey, "runtime.error.splitIndex");
  assert.deepEqual(second.error?.params, { index: 9, length: 2 });
});

test("time.get_os_time reports a formatted local timestamp", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("text.join", {
            fields: { count: 2 },
            inputs: { a: createBlock("time.get_os_time"), b: createBlock("text.literal", { fields: { value: "" } }) },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.match(loggedTexts(events)[0] ?? "", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test("os.exec_command prints stdout and fails on non-zero exits", async () => {
  const host: HostBridge = {
    name: "fake",
    capabilities: () => [OS_CAPABILITIES[0]!],
    async invoke() {
      return { stdout: "hello from shell\n", stderr: "", code: 0 };
    },
  };
  const project = projectWith(
    start([createBlock("os.exec_command", { fields: { command: "echo hi" } })]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { host, onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["hello from shell"]);

  const failing: HostBridge = {
    name: "fake",
    capabilities: () => [OS_CAPABILITIES[0]!],
    async invoke() {
      return { stdout: "", stderr: "boom\n", code: 7 };
    },
  };
  const failingResult = await runProject(project, { host: failing });
  assert.equal(failingResult.status, "error");
  assert.equal(failingResult.error?.messageKey, "runtime.error.commandFailed");
  assert.deepEqual(failingResult.error?.params, { code: 7 });
});

test("boolean conversions cover numbers, text and booleans", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: {
              value: createBlock("convert.toNumber", {
                inputs: { text: createBlock("logic.boolean", { fields: { value: true } }) },
              }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: { value: createBlock("logic.boolean", { fields: { value: false } }) },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: {
              value: createBlock("convert.toBoolean", {
                inputs: { value: createBlock("math.number", { fields: { value: 0 } }) },
              }),
            },
          }),
        },
      }),
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: {
              value: createBlock("convert.toBoolean", {
                inputs: { value: createBlock("text.literal", { fields: { value: "false" } }) },
              }),
            },
          }),
        },
      }),
    ]),
  );
  const events: RuntimeEvent[] = [];
  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["1", "false", "false", "false"]);
});

test("convert to boolean rejects other text", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: {
          text: createBlock("convert.toString", {
            inputs: {
              value: createBlock("convert.toBoolean", {
                inputs: { value: createBlock("text.literal", { fields: { value: "yes" } }) },
              }),
            },
          }),
        },
      }),
    ]),
  );
  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.toBoolean");
});

test("variables exist only after the create block runs", async () => {
  const project = projectWith(
    start([
      createBlock("io.print", {
        inputs: { text: createBlock("var.get", { fields: { variable: "score" } }) },
      }),
    ]),
  );

  const result = await runProject(project);
  assert.equal(result.status, "error");
  assert.equal(result.error?.messageKey, "runtime.error.missingVariable");
  assert.deepEqual(result.error?.params, { name: "score" });
});

test("create, assign, read and delete a variable at run time", async () => {
  const events: RuntimeEvent[] = [];
  const project = projectWith(
    start([
      declare("score", "number", createBlock("math.number", { fields: { value: 1 } })),
      createBlock("var.set", {
        fields: { variable: "score" },
        inputs: { value: createBlock("math.number", { fields: { value: 42 } }) },
      }),
      createBlock("io.print", {
        inputs: { text: createBlock("var.get", { fields: { variable: "score" } }) },
      }),
      createBlock("var.delete", { fields: { name: "score" } }),
      createBlock("io.print", {
        inputs: { text: createBlock("var.get", { fields: { variable: "score" } }) },
      }),
    ]),
  );

  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.deepEqual(loggedTexts(events), ["42"]);
  assert.equal(result.error?.messageKey, "runtime.error.missingVariable");
});

test("creating the same variable twice is an error", async () => {
  const project = projectWith(
    start([
      declare("n", "number", createBlock("math.number", { fields: { value: 0 } })),
      declare("n", "number", createBlock("math.number", { fields: { value: 1 } })),
    ]),
  );

  const result = await runProject(project);
  assert.equal(result.error?.messageKey, "runtime.error.variableExists");
});

test("the repeat counter and catch target declare variables on demand", async () => {
  const events: RuntimeEvent[] = [];
  const project = projectWith(
    start([
      createBlock("control.repeatWith", {
        fields: { variable: "i" },
        inputs: {
          times: createBlock("math.number", { fields: { value: 2 } }),
          body: [
            createBlock("io.print", {
              inputs: { text: createBlock("var.get", { fields: { variable: "i" } }) },
            }),
          ],
        },
      }),
      createBlock("io.print", {
        inputs: { text: createBlock("var.get", { fields: { variable: "i" } }) },
      }),
    ]),
  );

  const result = await runProject(project, { onEvent: (event) => events.push(event) });
  assert.equal(result.status, "finished");
  assert.deepEqual(loggedTexts(events), ["0", "1", "1"]);
});
