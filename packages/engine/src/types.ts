import type {
  BlockNode,
  BlockSchema,
  FieldValue,
  Project,
  Value,
  ValueType,
} from "@nexus/ir";
import type { BlockRegistry } from "./registry.ts";

export interface BlockDefinition extends BlockSchema {
  /** Accent colour for the canvas. */
  color: string;
  /** Statement/hat semantics. Required unless `kind` is `expression`. */
  execute?: (ctx: ExecutionContext, node: BlockNode) => void | Promise<void>;
  /** Expression semantics. Required when `kind` is `expression`. */
  evaluate?: (ctx: ExecutionContext, node: BlockNode) => Value | Promise<Value>;
}

/**
 * Everything a block can do while a program runs. The context is the only way
 * a block touches the outside world, which keeps the interpreter sandboxable.
 */
export interface ExecutionContext {
  readonly project: Project;
  readonly host: HostBridge;
  readonly signal: AbortSignal;

  /** Evaluate a nested expression block. */
  evaluate(node: BlockNode): Promise<Value>;
  /** Resolve a value port: plugged expression, inline literal, or port default. */
  input(node: BlockNode, port: string): Promise<Value>;
  /** Read an inline literal without evaluating anything. */
  literal(node: BlockNode, port: string): Value;
  /** Blocks connected to a stack port. */
  stack(node: BlockNode, port: string): BlockNode[];
  /** Run a stack in the current scope. */
  run(blocks: BlockNode[]): Promise<void>;

  getVariable(id: string): Value;
  setVariable(id: string, value: Value): void;
  /** Convert a value to the port type, failing with a user-facing error. */
  coerce(value: Value, type: ValueType, blockId: string): Value;
  variableName(id: string): string;

  /** Emit a console line. */
  print(value: Value, blockId?: string): void;
  /** Cooperative checkpoint: lets the UI paint and honours stop requests. */
  tick(): Promise<void>;
  /** Wait for a duration, aborting as soon as the run is stopped. */
  sleep(ms: number): Promise<void>;
  /** Throw a translatable runtime failure attributed to the current block. */
  fail(messageKey: string, params?: Record<string, string | number>): never;
}

export interface CapabilityDescriptor {
  /** Dotted id, e.g. `console.print`. Used by blocks and the permission layer. */
  id: string;
  /** Translation key describing the capability to the user. */
  descriptionKey: string;
  /**
   * How much damage the capability can do. The desktop shell will refuse
   * `high` capabilities unless a project explicitly opts in.
   */
  risk: "none" | "low" | "medium" | "high";
}

export interface HostRequest {
  capability: string;
  args: Value[];
  /** Block that requested the call; used for permission prompts and errors. */
  blockId?: string;
}

/**
 * Bridge between the language and whatever it runs inside: a browser tab, a
 * WebView, a CLI. The v0.1 host only prints; files/processes/network will be
 * added here without changing the interpreter.
 */
export interface HostBridge {
  readonly name: string;
  capabilities(): readonly CapabilityDescriptor[];
  invoke(request: HostRequest): Promise<Value>;
}

export type RuntimeEvent =
  | { kind: "log"; level: "info" | "error"; text: string; blockId?: string; time: number }
  | { kind: "status"; status: "running" | "finished" | "stopped" | "error"; durationMs?: number }
  | {
      kind: "error";
      blockId?: string;
      messageKey: string;
      params: Record<string, string | number>;
      time: number;
    };

export interface RunResult {
  status: "finished" | "stopped" | "error";
  durationMs: number;
  steps: number;
  error?: { messageKey: string; params: Record<string, string | number>; blockId?: string };
}

export interface RunOptions {
  onEvent?: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
  /** Block set to execute; defaults to the core blocks. */
  registry?: BlockRegistry;
  /** Hard step budget, protects the UI from accidental infinite loops. */
  stepLimit?: number;
  /** Replace the default local host (tests, desktop shell). */
  host?: HostBridge;
  /** How many interpreted blocks between event-loop yields. */
  yieldEvery?: number;
}

export type LiteralMap = Record<string, FieldValue>;
