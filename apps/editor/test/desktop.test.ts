import assert from "node:assert/strict";
import { test } from "node:test";
import { HostError } from "@nexus/engine";
import { createDesktopHost, isDesktopShell, type Invoke } from "../src/desktop.ts";

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
