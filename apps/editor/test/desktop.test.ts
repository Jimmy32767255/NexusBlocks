import assert from "node:assert/strict";
import { test } from "node:test";
import { HostError } from "@nexus/engine";
import {
  createDesktopFiles,
  createDesktopHost,
  isDesktopShell,
  type Invoke,
} from "../src/desktop.ts";

function capture(): { events: string[]; sink: (event: { kind: string; text?: string }) => void } {
  const events: string[] = [];
  return {
    events,
    sink: (event) => {
      if (event.text) events.push(event.text);
    },
  };
}

test("exposes console and file capabilities in the desktop shell", () => {
  const host = createDesktopHost(() => {}, async () => ({ ok: true, value: null }));
  assert.equal(host?.name, "desktop");
  const ids = host?.capabilities().map((capability) => capability.id) ?? [];
  assert.deepEqual(ids, [
    "console.print",
    "fs.read",
    "fs.write",
    "fs.exists",
    "fs.delete",
    "fs.list",
  ]);
});

test("console.print is handled locally and never reaches the shell", async () => {
  const calls: string[] = [];
  const { events, sink } = capture();
  const invoke: Invoke = async (command) => {
    calls.push(command);
    return { ok: true, value: null };
  };
  const host = createDesktopHost(sink as never, invoke);
  await host?.invoke({ capability: "console.print", args: ["hello", 3] });
  assert.deepEqual(events, ["hello 3"]);
  assert.deepEqual(calls, []);
});

test("file capabilities round-trip through capability_invoke", async () => {
  let seen: unknown = null;
  const invoke: Invoke = async (command, args) => {
    seen = { command, args };
    return { ok: true, value: "file body" };
  };
  const host = createDesktopHost(() => {}, invoke);
  const value = await host?.invoke({ capability: "fs.read", args: ["notes.txt"], blockId: "b1" });
  assert.equal(value, "file body");
  assert.deepEqual(seen, {
    command: "capability_invoke",
    args: {
      request: { capability: "fs.read", args: ["notes.txt"], blockId: "b1" },
    },
  });
});

test("fs.write sends non-text content as text, like the browser host", async () => {
  let seen: unknown = null;
  const host = createDesktopHost(() => {}, async (_command, args) => {
    seen = args;
    return { ok: true, value: true };
  });
  await host?.invoke({ capability: "fs.write", args: ["data.json", { ok: true }] });
  assert.deepEqual(seen, {
    request: {
      capability: "fs.write",
      args: ["data.json", '{"ok":true}'],
      blockId: undefined,
    },
  });
});

test("shell failures surface as translatable host errors", async () => {
  const host = createDesktopHost(() => {}, async () => ({
    ok: false,
    error: { messageKey: "runtime.error.fileNotFound", params: { path: "a.txt" } },
  }));
  await assert.rejects(
    () => host!.invoke({ capability: "fs.read", args: ["a.txt"] }),
    (error: unknown) => {
      assert.ok(error instanceof HostError);
      assert.equal(error.messageKey, "runtime.error.fileNotFound");
      assert.deepEqual(error.params, { path: "a.txt" });
      return true;
    },
  );
});

test("isDesktopShell is false outside a Tauri window", () => {
  assert.equal(isDesktopShell(), false);
});

test("project save asks the shell to write the file", async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke: Invoke = async (command, args) => {
    calls.push({ command, args });
    return { ok: true, value: { path: "/tmp/demo.nexusblocks.json" } };
  };
  const files = createDesktopFiles(invoke);
  const saved = await files.save("{}", "demo.nexusblocks.json");
  assert.deepEqual(saved, { path: "/tmp/demo.nexusblocks.json" });
  assert.deepEqual(calls, [
    {
      command: "project_save",
      args: { content: "{}", suggestedName: "demo.nexusblocks.json" },
    },
  ]);
});

test("a cancelled save dialog resolves to null instead of claiming success", async () => {
  const files = createDesktopFiles(async () => ({ ok: true, value: null }));
  assert.equal(await files.save("{}", "demo"), null);
});

test("project open returns the file text", async () => {
  const files = createDesktopFiles(async () => ({
    ok: true,
    value: { path: "/tmp/demo.nexusblocks.json", content: '{"version":1}' },
  }));
  assert.deepEqual(await files.open(), {
    path: "/tmp/demo.nexusblocks.json",
    content: '{"version":1}',
  });
});

test("a failed shell write surfaces as a HostError with the i18n key", async () => {
  const files = createDesktopFiles(async () => ({
    ok: false,
    error: { messageKey: "runtime.error.fileTooLarge" },
  }));
  await assert.rejects(() => files.save("{}", "demo"), (error: unknown) => {
    assert.ok(error instanceof HostError);
    assert.equal((error as HostError).messageKey, "runtime.error.fileTooLarge");
    return true;
  });
});
