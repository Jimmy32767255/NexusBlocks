import type { BlockNode } from "@nexus/ir";
import type { DebugHooks, DebugRuntimeView } from "./types.ts";
import { StopSignal } from "./errors.ts";

export interface DebugSessionOptions {
  /** Block ids that pause execution when reached. */
  breakpoints?: Iterable<string>;
  /** Milliseconds to wait before each statement; 0 disables tracing. */
  traceDelay?: number;
  signal: AbortSignal;
  onStatement?: (blockId: string) => void;
  onPause?: (blockId: string, values: Record<string, unknown>) => void;
  onResume?: () => void;
  onVariables?: (values: Record<string, unknown>) => void;
}

/**
 * Pause/resume gate shared by the editor and the interpreter.
 *
 * The session itself is just a set of hooks: the interpreter calls
 * `beforeStatement` before every executed statement and `afterStatement` once
 * it returns. Breakpoints and the pause button both funnel into the same
 * promise gate, so stopping works from either state.
 */
export class DebugSession implements DebugHooks {
  private breakpoints: Set<string>;
  private traceDelay: number;
  private readonly signal: AbortSignal;
  private readonly options: DebugSessionOptions;
  private pauseRequested = false;
  private paused = false;
  private stopped = false;
  /** Set while a paused session should execute exactly one more statement. */
  private stepPending = false;
  /** Pause at the next statement after a step was granted. */
  private stepArmed = false;
  private waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor(options: DebugSessionOptions) {
    this.options = options;
    this.breakpoints = new Set(options.breakpoints ?? []);
    this.traceDelay = Math.max(0, options.traceDelay ?? 0);
    this.signal = options.signal;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  setBreakpoints(ids: Iterable<string>): void {
    this.breakpoints = new Set(ids);
  }

  setTraceDelay(milliseconds: number): void {
    this.traceDelay = Math.max(0, milliseconds);
  }

  /** Ask to pause at the next statement boundary. */
  requestPause(): void {
    if (this.stopped) return;
    this.pauseRequested = true;
  }

  /** Release a paused interpreter and continue. */
  resume(): void {
    this.pauseRequested = false;
    if (!this.paused) return;
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve();
    this.options.onResume?.();
  }

  /** Execute one statement, then pause again at the next boundary. */
  step(): void {
    if (this.stopped || !this.paused) return;
    this.stepPending = true;
    this.paused = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve();
  }

  /** Abort a paused interpreter; the next gate throws `StopSignal`. */
  requestStop(): void {
    if (this.stopped) return;
    this.stopped = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.reject(new StopSignal());
  }

  async beforeStatement(node: BlockNode, view: DebugRuntimeView): Promise<void> {
    if (this.stopped || this.signal.aborted) throw new StopSignal();
    this.options.onStatement?.(node.id);
    if (this.traceDelay > 0) await this.sleep(this.traceDelay);

    let shouldPause = this.breakpoints.has(node.id) || this.pauseRequested;
    if (this.stepPending) {
      // The user stepped while paused here: run this statement and arm a pause
      // for the next boundary, even if this node has a breakpoint too.
      this.stepPending = false;
      this.stepArmed = true;
      this.pauseRequested = false;
      shouldPause = false;
    } else if (this.stepArmed) {
      this.stepArmed = false;
      shouldPause = true;
    }

    if (shouldPause) {
      this.pauseRequested = false;
      this.paused = true;
      this.options.onPause?.(node.id, view.variableValues());
      await this.waitForResume();
      if (this.stopped) throw new StopSignal();
      if (this.stepPending) {
        // A step was granted while we were waiting: run this statement, then
        // pause again at the next boundary.
        this.stepPending = false;
        this.stepArmed = true;
        this.paused = false;
      }
    }
  }

  afterStatement(_node: BlockNode, view: DebugRuntimeView): void {
    this.options.onVariables?.(view.variableValues());
  }

  private waitForResume(): Promise<void> {
    if (this.stopped || this.signal.aborted) return Promise.reject(new StopSignal());
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.signal.aborted) {
        reject(new StopSignal());
        return;
      }
      const timer = setTimeout(() => {
        this.signal.removeEventListener("abort", abort);
        resolve();
      }, milliseconds);
      const abort = () => {
        clearTimeout(timer);
        reject(new StopSignal());
      };
      this.signal.addEventListener("abort", abort, { once: true });
    });
  }
}
