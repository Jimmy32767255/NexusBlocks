import {
  coerce as coerceValue,
  collectFunctions,
  defaultValue,
  FUNCTION_DEFINE_TYPE,
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
import { ExitSignal, RuntimeFailure, StopSignal } from "./errors.ts";
import type { BlockRegistry } from "./registry.ts";
import type { BlockDefinition, ExecutionContext, HostBridge, RuntimeEvent } from "./types.ts";

export interface InterpreterOptions {
  host: HostBridge;
  emit: (event: RuntimeEvent) => void;
  signal: AbortSignal;
  stepLimit?: number;
  yieldEvery?: number;
  /** Localised text for caught runtime failures; defaults to the message key. */
  describeFailure?: (failure: RuntimeFailure) => string;
}

export const DEFAULT_STEP_LIMIT = 100_000;
export const DEFAULT_YIELD_EVERY = 256;
export const DEFAULT_CALL_DEPTH = 64;

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
  private readonly stepLimit: number;
  private readonly yieldEvery: number;
  private readonly variables = new Map<string, Value>();
  private readonly functions = new Map<string, FunctionDecl>();
  private readonly frames: Map<string, Value>[] = [];

  private steps = 0;
  private currentBlockId: string | undefined;

  constructor(project: Project, registry: BlockRegistry, options: InterpreterOptions) {
    this.project = project;
    this.registry = registry;
    this.host = options.host;
    this.emit = options.emit;
    this.describeFailureText = options.describeFailure ?? ((failure) => failure.messageKey);
    this.signal = options.signal;
    this.stepLimit = options.stepLimit ?? DEFAULT_STEP_LIMIT;
    this.yieldEvery = Math.max(1, options.yieldEvery ?? DEFAULT_YIELD_EVERY);

    for (const decl of collectFunctions(project.scripts)) {
      this.functions.set(decl.id, decl);
    }
    for (const variable of project.variables) {
      this.variables.set(
        variable.id,
        variable.initial ?? defaultValue(variable.type),
      );
    }
  }

  get stepCount(): number {
    return this.steps;
  }

  async runScripts(scripts: BlockNode[]): Promise<void> {
    await this.run(
      scripts.filter((node) => node.type !== FUNCTION_DEFINE_TYPE && !isImportType(node.type)),
    );
  }

  async run(blocks: BlockNode[]): Promise<void> {
    for (const node of blocks) {
      this.currentBlockId = node.id;
      await this.tick();
      const definition = this.definitionFor(node);
      if (definition.kind === "expression") {
        this.fail("runtime.error.expressionAsStatement", { type: node.type });
      }
      await definition.execute?.(this, node);
    }
  }

  async evaluate(node: BlockNode): Promise<Value> {
    this.currentBlockId = node.id;
    await this.tick();
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
    const definition = this.definitionFor(node);
    const portDef = portsOf(definition, node).find(
      (candidate) => candidate.name === port && candidate.kind === "value",
    );
    const type = portDef?.type ?? "any";
    const raw = node.fields?.[port];
    if (raw !== undefined) return this.coerce(raw, type, node.id);
    return this.coerce(portDef?.default ?? defaultValue(type), type, node.id);
  }

  literal(node: BlockNode, port: string): Value {
    const raw = node.fields?.[port];
    if (raw !== undefined) return raw;
    const definition = this.definitionFor(node);
    const portDef = portsOf(definition, node).find(
      (candidate) => candidate.name === port && candidate.kind === "value",
    );
    return portDef?.default ?? defaultValue(portDef?.type ?? "any");
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
    if (this.frames.length >= DEFAULT_CALL_DEPTH) {
      this.fail("runtime.error.callDepth", { limit: DEFAULT_CALL_DEPTH });
    }
    const frame = new Map<string, Value>();
    decl.params.forEach((param, index) => {
      frame.set(param.name, this.coerce(args[index] ?? defaultValue(param.type), param.type, decl.node.id));
    });
    this.frames.push(frame);
    try {
      await this.run((decl.node.inputs?.body as BlockNode[] | undefined) ?? []);
    } catch (error) {
      if (error instanceof ReturnSignal) {
        return decl.returnType === "void"
          ? null
          : this.coerce(error.value, decl.returnType, decl.node.id);
      }
      throw error;
    } finally {
      this.frames.pop();
    }
    return defaultValue(decl.returnType);
  }

  getVariable(id: string): Value {
    if (!this.variables.has(id)) {
      this.fail("runtime.error.missingVariable", { name: this.variableName(id) });
    }
    return this.variables.get(id) ?? null;
  }

  setVariable(id: string, value: Value): void {
    if (!this.variables.has(id)) {
      this.fail("runtime.error.missingVariable", { name: this.variableName(id) });
    }
    this.variables.set(id, value);
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

  variableName(id: string): string {
    return this.project.variables.find((variable) => variable.id === id)?.name ?? id;
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

  async tick(): Promise<void> {
    this.steps += 1;
    if (this.steps > this.stepLimit) {
      this.fail("runtime.error.stepLimit", { limit: this.stepLimit });
    }
    if (this.signal.aborted) throw new StopSignal();
    if (this.steps % this.yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  exit(code: number): never {
    throw new ExitSignal(code);
  }

  fail(messageKey: string, params: Record<string, string | number> = {}): never {
    throw new RuntimeFailure(messageKey, params, this.currentBlockId);
  }

  private definitionFor(node: BlockNode): BlockDefinition {
    const definition = this.registry.get(node.type);
    if (!definition) {
      this.fail("runtime.error.unknownBlock", { type: node.type });
    }
    return definition;
  }
}
