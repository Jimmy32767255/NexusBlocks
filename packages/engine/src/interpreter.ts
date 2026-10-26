import {
  coerce as coerceValue,
  collectFunctions,
  defaultValue,
  isFunctionDefine,
  isImportType,
  portsOf,
  toDisplayText,
  type BlockNode,
  type FunctionDecl,
  type Project,
  type Value,
  type ValueType,
} from "@nexus/ir";
import { ReturnSignal } from "./blocks/functions.ts";
import { ExitSignal, GotoSignal, RuntimeFailure, StopSignal } from "./errors.ts";
import type { BlockRegistry } from "./registry.ts";
import type {
  BlockDefinition,
  DebugFrame,
  DebugHooks,
  ExecutionContext,
  HostBridge,
  RuntimeEvent,
} from "./types.ts";

export interface InterpreterOptions {
  host: HostBridge;
  emit: (event: RuntimeEvent) => void;
  signal: AbortSignal;
  args?: readonly string[];
  yieldEvery?: number;
  /** Localised text for caught runtime failures; defaults to the message key. */
  describeFailure?: (failure: RuntimeFailure) => string;
  /** Editor debugger hooks; the interpreter works without them. */
  debug?: DebugHooks;
}

export const DEFAULT_YIELD_EVERY = 1024;

/**
 * Yield to the host event loop cheaply. `setTimeout(0)` is clamped to ~1ms in
 * Node and browsers, which dominates long runs; `setImmediate`/`MessageChannel`
 * hand control back in microseconds while still letting timers and renders run.
 */
const yieldToEventLoop: () => Promise<void> = (() => {
  const immediate = (globalThis as { setImmediate?: (cb: () => void) => unknown }).setImmediate;
  if (typeof immediate === "function") {
    return () => new Promise<void>((resolve) => immediate(resolve));
  }
  if (typeof MessageChannel === "function") {
    return () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
  }
  return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
})();

/**
 * Tree-walking interpreter. It owns no globals: variables live per run, and
 * every outside effect goes through the host bridge, so the same interpreter
 * runs in a browser tab or in a native shell.
 */
export class Interpreter implements ExecutionContext {
  readonly project: Project;
  readonly host: HostBridge;
  readonly signal: AbortSignal;

  private readonly describeFailureText: (failure: RuntimeFailure) => string;

  private readonly registry: BlockRegistry;
  private readonly emit: (event: RuntimeEvent) => void;
  private readonly debug: DebugHooks | undefined;
  private readonly yieldEvery: number;
  private currentArgs: readonly string[];

  private readonly variables = new Map<string, Value>();
  private readonly functions = new Map<string, FunctionDecl>();
  private readonly frames: Map<string, Value>[] = [];
  private readonly activeCalls: DebugFrame[] = [];

  /** One local table per running function call, so recursion keeps its own state. */
  private readonly locals: Map<string, Value>[] = [];

  private steps = 0;
  private currentBlockId: string | undefined;
  /** Per-node definition cache: the registry lookup is pure per block type. */
  private readonly definitions = new WeakMap<BlockNode, BlockDefinition>();
  /** Port metadata cache for blocks with static ports, keyed by type then port. */
  private readonly portCache = new Map<string, Map<string, { type: ValueType; fallback: Value }>>();

  constructor(project: Project, registry: BlockRegistry, options: InterpreterOptions) {
    this.project = project;
    this.registry = registry;
    this.host = options.host;
    this.emit = options.emit;
    this.describeFailureText = options.describeFailure ?? ((failure) => failure.messageKey);
    this.debug = options.debug;
    this.signal = options.signal;
    this.yieldEvery = Math.max(1, options.yieldEvery ?? DEFAULT_YIELD_EVERY);
    this.currentArgs = options.args ?? [];

    for (const decl of collectFunctions(project.scripts)) {
      this.functions.set(decl.id, decl);
    }
  }

  get args(): readonly string[] {
    return this.currentArgs;
  }

  setArgs(args: readonly string[]): void {
    this.currentArgs = args.map((value) => String(value));
  }

  get stepCount(): number {
    return this.steps;
  }

  /** Live variables declared at run time, keyed by name (debugger display). */
  variableValues(): Record<string, Value> {
    return Object.fromEntries(this.variables);
  }

  async runScripts(scripts: BlockNode[]): Promise<void> {
    for (const node of scripts) {
      if (isFunctionDefine(node.type) || isImportType(node.type)) continue;
      await this.runFrame([node]);
    }
  }

  /**
   * Run one script/function frame. `goto` unwinds to the matching label by
   * resuming the label's stack and then each enclosing stack after its child,
   * so execution continues outward exactly where the jump landed.
   */
  private async runFrame(body: BlockNode[]): Promise<void> {
    const labels = collectLabels(body);
    let target: GotoTarget | null = null;
    for (;;) {
      try {
        if (target) {
          const next = target;
          target = null;
          await this.resumeFrom(next);
        } else {
          await this.run(body);
        }
        return;
      } catch (error) {
        if (!(error instanceof GotoSignal)) throw error;
        const found = labels.get(error.label);
        if (!found) this.fail("runtime.error.unknownLabel", { name: error.label });
        target = found;
      }
    }
  }

  private async resumeFrom(target: GotoTarget): Promise<void> {
    await this.run(target.stack.slice(target.index));
    for (let index = target.ancestors.length - 1; index >= 0; index -= 1) {
      const ancestor = target.ancestors[index]!;
      await this.run(ancestor.stack.slice(ancestor.index + 1));
    }
  }

  async run(blocks: BlockNode[]): Promise<void> {
    for (const node of blocks) {
      this.currentBlockId = node.id;
      const definition = this.definitionFor(node);
      // Hats are entry points, not steps. Debugging hooks (breakpoints,
      // tracing, pause) only observe executable statements.
      if (definition.kind === "statement") {
        await this.debug?.beforeStatement?.(node, this);
      }
      if (this.step()) await yieldToEventLoop();
      if (definition.kind === "expression") {
        this.fail("runtime.error.expressionAsStatement", { type: node.type });
      }
      await definition.execute?.(this, node);
      if (definition.kind === "statement") {
        this.debug?.afterStatement?.(node, this);
      }
    }
  }

  async evaluate(node: BlockNode): Promise<Value> {
    this.currentBlockId = node.id;
    if (this.step()) await yieldToEventLoop();
    const definition = this.definitionFor(node);
    if (definition.kind !== "expression" || !definition.evaluate) {
      this.fail("runtime.error.statementAsValue", { type: node.type });
    }
    return definition.evaluate(this, node);
  }

  async input(node: BlockNode, port: string): Promise<Value> {
    const child = node.inputs?.[port];
    if (child !== undefined && !Array.isArray(child)) {
      const value = await this.evaluate(child);
      this.currentBlockId = node.id;
      return value;
    }
    const type = this.valuePortType(node, port);
    const raw = node.fields?.[port];
    if (raw !== undefined) return this.coerce(raw, type, node.id);
    return this.coerce(this.valuePortDefault(node, port), type, node.id);
  }

  literal(node: BlockNode, port: string): Value {
    const raw = node.fields?.[port];
    if (raw !== undefined) return raw;
    return this.valuePortDefault(node, port);
  }

  /**
   * Value-port metadata, cached per static block type. Dynamic blocks
   * (`func.call:<id>`) build their port list per node, so they stay uncached.
   */
  private valuePort(node: BlockNode, port: string): { type: ValueType; fallback: Value } {
    const definition = this.definitionFor(node);
    if (definition.dynamicPorts) {
      const found = definition.dynamicPorts(node).find(
        (candidate) => candidate.name === port && candidate.kind === "value",
      );
      const type = found?.type ?? "any";
      return { type, fallback: found?.default ?? defaultValue(type) };
    }
    let byPort = this.portCache.get(definition.type);
    if (!byPort) {
      byPort = new Map();
      this.portCache.set(definition.type, byPort);
    }
    const hit = byPort.get(port);
    if (hit) return hit;
    const found = portsOf(definition, node).find(
      (candidate) => candidate.name === port && candidate.kind === "value",
    );
    const type = found?.type ?? "any";
    const entry = { type, fallback: found?.default ?? defaultValue(type) };
    byPort.set(port, entry);
    return entry;
  }

  private valuePortType(node: BlockNode, port: string): ValueType {
    return this.valuePort(node, port).type;
  }

  private valuePortDefault(node: BlockNode, port: string): Value {
    return this.valuePort(node, port).fallback;
  }

  stack(node: BlockNode, port: string): BlockNode[] {
    const value = node.inputs?.[port];
    return Array.isArray(value) ? value : [];
  }

  getParam(name: string): Value {
    const frame = this.frames[this.frames.length - 1];
    if (!frame || !frame.has(name)) {
      this.fail("runtime.error.paramScope", { name });
    }
    return frame.get(name) ?? null;
  }

  async callFunction(id: string, args: Value[]): Promise<Value> {
    const decl = this.functions.get(id);
    if (!decl) this.fail("runtime.error.unknownFunction", { name: id });
    const params = decl.params;
    const frame = new Map<string, Value>();
    for (let index = 0; index < params.length; index += 1) {
      const param = params[index]!;
      frame.set(param.name, this.coerce(args[index] ?? defaultValue(param.type), param.type, decl.node.id));
    }
    this.frames.push(frame);
    this.locals.push(new Map());
    if (this.debug) this.activeCalls.push({ name: decl.name, blockId: decl.node.id });
    try {
      await this.runFrame((decl.node.inputs?.body as BlockNode[] | undefined) ?? []);
    } catch (error) {
      if (error instanceof ReturnSignal) {
        if (decl.kind === "action") this.fail("runtime.error.returnInAction", { name: decl.name });
        return this.coerce(error.value, decl.returnType, decl.node.id);
      }
      throw error;
    } finally {
      this.frames.pop();
      this.locals.pop();
      if (this.debug) this.activeCalls.pop();
    }
    return defaultValue(decl.returnType);
  }

  callStack(): DebugFrame[] {
    return [...this.activeCalls];
  }

  getVariable(name: string): Value {
    const local = this.locals[this.locals.length - 1];
    if (local?.has(name)) return local.get(name) ?? null;
    if (!this.variables.has(name)) {
      this.fail("runtime.error.missingVariable", { name });
    }
    return this.variables.get(name) ?? null;
  }

  hasVariable(name: string): boolean {
    const local = this.locals[this.locals.length - 1];
    return Boolean(local?.has(name)) || this.variables.has(name);
  }

  setVariable(name: string, value: Value): void {
    const local = this.locals[this.locals.length - 1];
    if (local?.has(name)) {
      local.set(name, value);
      return;
    }
    if (!this.variables.has(name)) {
      this.fail("runtime.error.missingVariable", { name });
    }
    this.variables.set(name, value);
  }

  createVariable(name: string, value: Value): void {
    if (this.variables.has(name)) this.fail("runtime.error.variableExists", { name });
    this.variables.set(name, value);
  }

  createLocalVariable(name: string, value: Value): void {
    const local = this.locals[this.locals.length - 1];
    if (!local) this.fail("runtime.error.localOutsideFunction", { name });
    const frame = this.frames[this.frames.length - 1];
    if (frame?.has(name)) this.fail("runtime.error.variableExists", { name });
    local.set(name, value);
  }

  setLocalVariable(name: string, value: Value): void {
    const local = this.locals[this.locals.length - 1];
    if (!local) this.fail("runtime.error.localOutsideFunction", { name });
    if (!local.has(name)) this.fail("runtime.error.missingVariable", { name });
    local.set(name, value);
  }

  deleteVariable(name: string): void {
    if (!this.variables.has(name)) {
      this.fail("runtime.error.missingVariable", { name });
    }
    this.variables.delete(name);
  }

  coerce(value: Value, type: ValueType, _blockId: string): Value {
    if (type === "any" || type === "void") return value;
    const result = coerceValue(value, type);
    if (result.ok) return result.value;
    if (result.reason === "number") {
      this.fail("runtime.error.badNumber", { value: toDisplayText(value) });
    }
    this.fail("runtime.error.badType", { from: typeof value === "object" ? "object" : typeof value, to: type });
  }

  describeFailure(failure: RuntimeFailure): string {
    return this.describeFailureText(failure);
  }

  print(value: Value, blockId?: string): void {
    this.emit({
      kind: "log",
      level: "info",
      text: toDisplayText(value),
      blockId: blockId ?? this.currentBlockId,
      time: Date.now(),
    });
  }

  async sleep(ms: number): Promise<void> {
    if (this.signal.aborted) throw new StopSignal();
    if (ms <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new StopSignal());
      };
      const timer = setTimeout(() => {
        this.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Count one step; returns true when a cooperative pause is due. */
  private step(): boolean {
    this.steps += 1;
    if (this.signal.aborted) throw new StopSignal();
    return this.steps % this.yieldEvery === 0;
  }

  async tick(): Promise<void> {
    if (this.step()) await yieldToEventLoop();
  }

  exit(code: number): never {
    throw new ExitSignal(code);
  }

  fail(messageKey: string, params: Record<string, string | number> = {}): never {
    throw new RuntimeFailure(messageKey, params, this.currentBlockId);
  }

  private definitionFor(node: BlockNode): BlockDefinition {
    const cached = this.definitions.get(node);
    if (cached) return cached;
    const definition = this.registry.get(node.type);
    if (!definition) {
      this.fail("runtime.error.unknownBlock", { type: node.type });
    }
    this.definitions.set(node, definition);
    return definition;
  }
}

interface GotoTarget {
  /** The stack that directly contains the label. */
  stack: BlockNode[];
  index: number;
  /** Enclosing stacks from the frame root inwards, with the child's index. */
  ancestors: { stack: BlockNode[]; index: number }[];
}

/** Index labels in a frame. First definition wins; catch branches are skipped. */
function collectLabels(body: BlockNode[]): Map<string, GotoTarget> {
  const labels = new Map<string, GotoTarget>();
  const visit = (stack: BlockNode[], ancestors: { stack: BlockNode[]; index: number }[]): void => {
    stack.forEach((node, index) => {
      if (node.type === "control.label") {
        const name = String(node.fields?.name ?? "").trim();
        if (name && !labels.has(name)) labels.set(name, { stack, index, ancestors });
      }
      for (const [port, value] of Object.entries(node.inputs ?? {})) {
        if (port === "catches" || !Array.isArray(value)) continue;
        visit(value, [...ancestors, { stack, index }]);
      }
    });
  };
  visit(body, []);
  return labels;
}
