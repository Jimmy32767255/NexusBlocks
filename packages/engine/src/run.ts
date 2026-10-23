import { validateProject, type Project } from "@nexus/ir";
import { CapabilityUnavailableError, createLocalHost } from "./host.ts";
import { Interpreter } from "./interpreter.ts";
import { BreakSignal, RuntimeFailure, StopSignal } from "./errors.ts";
import { createProjectRegistry } from "./registry.ts";
import type { RunOptions, RunResult, RuntimeEvent } from "./types.ts";

/**
 * Validate then execute every top-level script in order. Runtime errors are
 * reported as events (translated by the UI) and in the returned result; the
 * function never throws for a user-level mistake.
 */
export async function runProject(project: Project, options: RunOptions = {}): Promise<RunResult> {
  const started = performance.now();
  const emit = options.onEvent ?? (() => {});
  const registry = options.registry ?? createProjectRegistry(project);

  const diagnostics = validateProject(project, registry);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    for (const diagnostic of errors) {
      emit({
        kind: "error",
        blockId: diagnostic.blockId,
        messageKey: `diag.${diagnostic.code}`,
        params: diagnostic.params ?? {},
        time: Date.now(),
      });
    }
    const first = errors[0]!;
    emit({ kind: "status", status: "error", durationMs: performance.now() - started });
    return {
      status: "error",
      durationMs: performance.now() - started,
      steps: 0,
      error: {
        messageKey: `diag.${first.code}`,
        params: first.params ?? {},
        blockId: first.blockId,
      },
    };
  }

  if (project.scripts.length === 0) {
    emit({ kind: "status", status: "finished", durationMs: performance.now() - started });
    return { status: "finished", durationMs: performance.now() - started, steps: 0 };
  }

  const controller = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const host = options.host ?? createLocalHost(emit, options.storage);
  const interpreter = new Interpreter(project, registry, {
    host,
    emit,
    signal: controller.signal,
    stepLimit: options.stepLimit,
    yieldEvery: options.yieldEvery,
  });

  emit({ kind: "status", status: "running" });
  try {
    await interpreter.runScripts(project.scripts);
  } catch (error) {
    const durationMs = performance.now() - started;
    if (error instanceof StopSignal) {
      emit({ kind: "status", status: "stopped", durationMs });
      return { status: "stopped", durationMs, steps: interpreter.stepCount };
    }
    if (error instanceof BreakSignal) {
      emit({
        kind: "error",
        messageKey: "runtime.error.breakOutsideLoop",
        params: {},
        time: Date.now(),
      });
      emit({ kind: "status", status: "error", durationMs });
      return {
        status: "error",
        durationMs,
        steps: interpreter.stepCount,
        error: { messageKey: "runtime.error.breakOutsideLoop", params: {} },
      };
    }
    if (error instanceof RuntimeFailure) {
      const blockId = error.blockId;
      emit({
        kind: "error",
        blockId,
        messageKey: error.messageKey,
        params: error.params,
        time: Date.now(),
      });
      emit({ kind: "status", status: "error", durationMs });
      return {
        status: "error",
        durationMs,
        steps: interpreter.stepCount,
        error: { messageKey: error.messageKey, params: error.params, blockId },
      };
    }
    if (error instanceof CapabilityUnavailableError) {
      const messageKey = "runtime.error.capability";
      const params = { capability: error.capability };
      emit({ kind: "error", messageKey, params, time: Date.now() });
      emit({ kind: "status", status: "error", durationMs });
      return { status: "error", durationMs, steps: interpreter.stepCount, error: { messageKey, params } };
    }
    const detail = error instanceof Error ? error.message : String(error);
    emit({ kind: "error", messageKey: "runtime.error.internal", params: { detail }, time: Date.now() });
    emit({ kind: "status", status: "error", durationMs });
    return {
      status: "error",
      durationMs,
      steps: interpreter.stepCount,
      error: { messageKey: "runtime.error.internal", params: { detail } },
    };
  }

  const durationMs = performance.now() - started;
  emit({ kind: "status", status: "finished", durationMs });
  return { status: "finished", durationMs, steps: interpreter.stepCount };
}

/** Turn a runtime event into a one-line log message for simple hosts. */
export function describeEvent(event: RuntimeEvent): string {
  switch (event.kind) {
    case "log":
      return `[${event.level}] ${event.text}`;
    case "status":
      return `[status] ${event.status}`;
    case "error":
      return `[error] ${event.messageKey}`;
  }
}
