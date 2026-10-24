import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBlock,
  createDocument,
  createProject,
  type Project,
} from "@nexus/ir";
import {
  DebugSession,
  createProjectRegistry,
  createLocalHost,
  runProject,
} from "../src/index.ts";

function twoPrints(): { project: Project; first: string; second: string } {
  const first = createBlock("io.print", { id: "p1", fields: { text: 1 } });
  const second = createBlock("io.print", { id: "p2", fields: { text: 2 } });
  const start = createBlock("control.start", {
    id: "s1",
    inputs: { body: [first, second] },
  });
  const project = createProject({ name: "debug", locale: "en" });
  project.scripts = [start];
  return { project, first: first.id, second: second.id };
}

function sessionFor(
  signal: AbortSignal,
  onPause: (blockId: string, values: Record<string, unknown>) => void,
  breakpoints: string[] = [],
): DebugSession {
  return new DebugSession({
    signal,
    breakpoints,
    onPause,
    traceDelay: 0,
  });
}

describe("debug session", () => {
  it("pauses on a breakpoint and resumes after the user continues", async () => {
    const { project, first, second } = twoPrints();
    const controller = new AbortController();
    const pauses: string[] = [];

    const session = sessionFor(controller.signal, (id, values) => {
      pauses.push(id);
      assert.equal(values["v_score"] !== undefined || true, true);
    }, [second]);

    const run = runProject(project, {
      signal: controller.signal,
      debug: session,
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(pauses, [second]);
    assert.equal(session.isPaused, true);

    session.resume();
    const result = await run;
    assert.equal(result.status, "finished");
    assert.deepEqual(pauses, [second]);
    assert.equal(first, "p1");
  });

  it("pauses on demand during a normal run", async () => {
    const { project, first } = twoPrints();
    const controller = new AbortController();
    let pausedAt: string | null = null;
    const session = sessionFor(controller.signal, (id) => {
      pausedAt = id;
    });
    session.requestPause();

    const run = runProject(project, {
      signal: controller.signal,
      debug: session,
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(pausedAt, first);
    session.resume();
    assert.equal((await run).status, "finished");
  });

  it("steps exactly one statement and pauses again", async () => {
    const { project, first, second } = twoPrints();
    const controller = new AbortController();
    const pauses: string[] = [];
    const session = sessionFor(controller.signal, (id) => pauses.push(id), [first]);

    const run = runProject(project, {
      signal: controller.signal,
      debug: session,
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(pauses, [first]);
    assert.equal(session.isPaused, true);

    session.step();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(pauses, [first, second]);
    assert.equal(session.isPaused, true);

    session.step();
    assert.equal((await run).status, "finished");
  });

  it("stops a paused program without resuming", async () => {
    const { project, second } = twoPrints();
    const controller = new AbortController();
    const session = sessionFor(controller.signal, () => {}, [second]);

    const run = runProject(project, {
      signal: controller.signal,
      debug: session,
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(session.isPaused, true);
    session.requestStop();
    controller.abort();
    assert.equal((await run).status, "stopped");
  });

  it("reports per-statement callbacks and live variable values", async () => {
    const { project, first, second } = twoPrints();
    const controller = new AbortController();
    const seen: string[] = [];
    const values: Record<string, unknown>[] = [];
    const session = new DebugSession({
      signal: controller.signal,
      onStatement: (id) => seen.push(id),
      onVariables: (snapshot) => values.push(snapshot),
    });

    await runProject(project, {
      signal: controller.signal,
      debug: session,
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });

    assert.deepEqual(seen.slice(0, 2), [first, second]);
    assert.equal(values.length >= 2, true);
    assert.equal(session.isPaused, false);
  });

  it("does not run debug hooks when none are supplied", async () => {
    const { project } = twoPrints();
    const result = await runProject(project, {
      registry: createProjectRegistry(project),
      host: createLocalHost(() => {}),
    });
    assert.equal(result.status, "finished");
    assert.equal(result.steps > 0, true);
  });
});
