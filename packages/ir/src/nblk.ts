/**
 * `.nblk` — a line-oriented, human-readable text format for Nexus Blocks
 * projects.
 *
 * The format deliberately mirrors ordinary code:
 *
 * ```nblk
 * project "Hello"
 * locale zh-CN
 *
 * start:
 *   create score as 0
 *   print "Hello, world!"
 *   set score to score + 1
 * ```
 *
 * Blocks are printed with their own syntax; blocks without a dedicated form
 * fall back to a `raw { ... }` JSON form so unknown/future blocks still round
 * trip. Variables live at run time: `var.create` declares one, and every other
 * block refers to it by name.
 */
import { createBlock, createDocument, createProject, touchProject } from "./create.ts";
import { createId } from "./ids.ts";
import {
  collectFunctions,
  formatParams,
  functionCallType,
  functionNameCallType,
  parseParams,
  FUNCTION_DEFINE_ACTION_TYPE,
  FUNCTION_DEFINE_TYPE,
  FUNCTION_DEFINE_VALUE_TYPE,
  FUNCTION_PARAM_TYPE,
  FUNCTION_RETURN_TYPE,
} from "./functions.ts";
import { IMPORT_ALIAS_TYPE, IMPORT_ALL_TYPE, IMPORT_NAMED_TYPE, isImportType } from "./imports.ts";
import type {
  BlockNode,
  BlockSchema,
  FieldValue,
  NexusDocument,
  PortDef,
  Project,
  Value,
  ValueType,
} from "./model.ts";
import { VALUE_TYPES } from "./model.ts";
import { defaultValue } from "./values.ts";
import { localizeLine, typeToZh } from "./nblk-zh.ts";

export const NBLK_EXTENSION = ".nblk" as const;

export interface NblkError {
  line: number;
  message: string;
}

export type NblkParseResult =
  | { ok: true; document: NexusDocument; warnings: string[] }
  | { ok: false; error: NblkError };

/** Minimal schema source needed to render dynamic ports. */
export interface NblkSchemaSource {
  get(type: string): BlockSchema | undefined;
}

class NblkFailure extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = "NblkFailure";
    this.line = line;
  }
}

interface Line {
  indent: number;
  text: string;
  number: number;
}

interface CallPending {
  name: string;
  args: Expr[];
  line: number;
}

type Expr =
  | { kind: "literal"; value: Value }
  | { kind: "name"; name: string }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "list"; items: Expr[] }
  | { kind: "dict"; entries: { key: string; value: Expr }[] }
  | { kind: "index"; target: Expr; index: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "unary"; op: "-"; value: Expr };

interface ExprToken {
  kind: "string" | "number" | "name" | "punctuation" | "end";
  text: string;
  value?: string | number;
}

const COMPARISONS = ["==", "!=", "<=", ">=", "<", ">"] as const;
const ADDITIVE = ["+", "-"] as const;
const MULTIPLICATIVE = ["*", "/", "%"] as const;

function fail(line: number, message: string): never {
  throw new NblkFailure(line, message);
}

function tokenizeExpr(source: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }
    if (char === '"') {
      let raw = '"';
      index += 1;
      while (index < source.length) {
        const current = source[index]!;
        raw += current;
        index += 1;
        if (current === "\\") {
          if (index < source.length) {
            raw += source[index]!;
            index += 1;
          }
          continue;
        }
        if (current === '"') break;
      }
      if (!raw.endsWith('"') || raw.length < 2) throw new NblkFailure(0, "Unterminated string");
      let value: string;
      try {
        value = JSON.parse(raw) as string;
      } catch {
        throw new NblkFailure(0, `Invalid string literal: ${raw}`);
      }
      tokens.push({ kind: "string", text: raw, value });
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(source[index + 1] ?? ""))) {
      let raw = "";
      while (index < source.length && /[0-9.eE+-]/.test(source[index]!)) {
        // Stop at a `+`/`-` that is not part of an exponent.
        const current = source[index]!;
        if ((current === "+" || current === "-") && !/[eE]$/.test(raw)) break;
        raw += current;
        index += 1;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new NblkFailure(0, `Invalid number: ${raw}`);
      tokens.push({ kind: "number", text: raw, value });
      continue;
    }
    if (/[\p{L}_]/u.test(char)) {
      let raw = "";
      while (index < source.length && /[\p{L}\p{N}_]/u.test(source[index]!)) {
        raw += source[index]!;
        index += 1;
      }
      tokens.push({ kind: "name", text: raw });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ kind: "punctuation", text: two });
      index += 2;
      continue;
    }
    if ("()[]{},:+-*/%<>".includes(char)) {
      tokens.push({ kind: "punctuation", text: char });
      index += 1;
      continue;
    }
    throw new NblkFailure(0, `Unexpected character: ${char}`);
  }
  tokens.push({ kind: "end", text: "" });
  return tokens;
}

class ExprParser {
  private position = 0;
  private readonly tokens: ExprToken[];

  constructor(source: string) {
    this.tokens = tokenizeExpr(source);
  }

  parse(): Expr {
    const expression = this.parseComparison();
    if (this.peek().kind !== "end") {
      throw new NblkFailure(0, `Unexpected token: ${this.peek().text}`);
    }
    return expression;
  }

  private peek(): ExprToken {
    return this.tokens[this.position] ?? { kind: "end", text: "" };
  }

  private take(): ExprToken {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private accept(text: string): boolean {
    if (this.peek().kind === "punctuation" && this.peek().text === text) {
      this.position += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.accept(text)) throw new NblkFailure(0, `Expected ${text}`);
  }

  private parseComparison(): Expr {
    let left = this.parseAdditive();
    while (this.peek().kind === "punctuation" && (COMPARISONS as readonly string[]).includes(this.peek().text)) {
      const op = this.take().text;
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    while (this.peek().kind === "punctuation" && (ADDITIVE as readonly string[]).includes(this.peek().text)) {
      const op = this.take().text;
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    while (this.peek().kind === "punctuation" && (MULTIPLICATIVE as readonly string[]).includes(this.peek().text)) {
      const op = this.take().text;
      const right = this.parseUnary();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.accept("-")) return { kind: "unary", op: "-", value: this.parseUnary() };
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let target = this.parsePrimary();
    for (;;) {
      if (this.accept("[")) {
        const index = this.parseComparison();
        this.expect("]");
        target = { kind: "index", target, index };
        continue;
      }
      break;
    }
    return target;
  }

  private parsePrimary(): Expr {
    const token = this.take();
    if (token.kind === "string") return { kind: "literal", value: token.value as string };
    if (token.kind === "number") return { kind: "literal", value: token.value as number };
    if (token.kind === "name") {
      if (token.text === "true") return { kind: "literal", value: true };
      if (token.text === "false") return { kind: "literal", value: false };
      if (token.text === "null") return { kind: "literal", value: null };
      if (this.accept("(")) {
        const args = this.parseArguments();
        return { kind: "call", name: token.text, args };
      }
      return { kind: "name", name: token.text };
    }
    if (token.kind === "punctuation" && token.text === "(") {
      const inner = this.parseComparison();
      this.expect(")");
      return inner;
    }
    if (token.kind === "punctuation" && token.text === "[") {
      const items: Expr[] = [];
      if (!this.accept("]")) {
        for (;;) {
          items.push(this.parseComparison());
          if (!this.accept(",")) break;
          if (this.accept("]")) break;
        }
        this.expect("]");
      }
      return { kind: "list", items };
    }
    if (token.kind === "punctuation" && token.text === "{") {
      const entries: { key: string; value: Expr }[] = [];
      if (!this.accept("}")) {
        for (;;) {
          const keyToken = this.take();
          let key: string;
          if (keyToken.kind === "string" || keyToken.kind === "name") key = String(keyToken.value ?? keyToken.text);
          else throw new NblkFailure(0, "Expected an object key");
          this.expect(":");
          entries.push({ key, value: this.parseComparison() });
          if (!this.accept(",")) break;
          if (this.accept("}")) break;
        }
        this.expect("}");
      }
      return { kind: "dict", entries };
    }
    throw new NblkFailure(0, `Unexpected token: ${token.text}`);
  }

  private parseArguments(): Expr[] {
    const args: Expr[] = [];
    if (this.accept(")")) return args;
    for (;;) {
      args.push(this.parseComparison());
      if (!this.accept(",")) break;
    }
    this.expect(")");
    return args;
  }
}

function parseExpression(text: string, line: number): Expr {
  try {
    return new ExprParser(text).parse();
  } catch (error) {
    if (error instanceof NblkFailure) fail(line, error.message);
    throw error;
  }
}

/** Collection literals cannot live in a field, so wrap them in a block. */
function literalBlock(value: Value): BlockNode {
  const items = JSON.stringify(value);
  return Array.isArray(value)
    ? createBlock("list.literal", { fields: { items } })
    : createBlock("dict.literal", { fields: { items } });
}

function literalOf(expr: Expr, line: number): Value {
  if (expr.kind !== "literal") fail(line, "Only constant values are allowed here");
  return expr.value;
}

function valueOfExpr(expr: Expr): Value {
  switch (expr.kind) {
    case "literal":
      return expr.value;
    case "list":
      return expr.items.map(valueOfExpr);
    case "dict":
      return Object.fromEntries(expr.entries.map((entry) => [entry.key, valueOfExpr(entry.value)]));
    case "unary": {
      const value = valueOfExpr(expr.value);
      if (typeof value !== "number") fail(0, "raw() only supports numeric negation");
      return -value;
    }
    default:
      fail(0, "raw() expects a constant JSON value");
  }
}

/** Parse a comma-separated argument list for statement forms with many args. */
function parseArguments(text: string, line: number): Expr[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const args: Expr[] = [];
  let depth = 0;
  let start = 0;
  let quote = false;
  let escaped = false;
  for (let index = 0; index <= trimmed.length; index += 1) {
    const char = trimmed[index];
    if (index === trimmed.length || (char === "," && depth === 0 && !quote)) {
      const piece = trimmed.slice(start, index).trim();
      if (!piece) fail(line, "Empty argument");
      args.push(parseExpression(piece, line));
      start = index + 1;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') quote = true;
    else if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
  }
  return args;
}

interface ValuePlacement {
  fields?: Record<string, FieldValue>;
  inputs?: Record<string, BlockNode>;
}

class Parser {
  private readonly lines: Line[] = [];
  private index = 0;
  private project: Project;
  private readonly pending = new Map<string, CallPending>();
  private readonly params = new Set<string>();
  readonly warnings: string[] = [];

  constructor(source: string) {
    const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
    rawLines.forEach((raw, lineIndex) => {
      if (raw.trim() === "") return;
      if (raw.trimStart().startsWith("#")) return;
      if (/\t/.test(raw.slice(0, raw.length - raw.trimStart().length))) {
        fail(lineIndex + 1, "Tabs are not allowed for indentation; use spaces");
      }
      const indent = raw.length - raw.trimStart().length;
      this.lines.push({ indent, text: localizeLine(raw.trim()), number: lineIndex + 1 });
    });
    this.project = createProject();
  }

  parse(): NexusDocument {
    this.parseHeader();
    this.skipLegacyVariables();
    while (this.index < this.lines.length) {
      const node = this.parseScript();
      this.project.scripts.push(node);
    }
    this.resolveCalls();
    if (this.project.scripts.length === 0) this.warnings.push("The project has no scripts");
    return createDocument(touchProject(this.project));
  }

  private parseHeader(): void {
    while (this.index < this.lines.length && this.lines[this.index]!.indent === 0) {
      const line = this.lines[this.index]!;
      if (line.text === "project" || line.text.startsWith("project ")) {
        this.index += 1;
        const rest = line.text.slice("project".length).trim();
        if (!rest) fail(line.number, 'Expected a project name, e.g. project "My project"');
        const expr = parseExpression(rest, line.number);
        if (expr.kind !== "literal" || typeof expr.value !== "string") fail(line.number, "Project name must be a string");
        this.project.name = expr.value;
        continue;
      }
      if (line.text === "locale" || line.text.startsWith("locale ")) {
        this.index += 1;
        const rest = line.text.slice("locale".length).trim();
        if (!/^[\w-]+$/.test(rest)) fail(line.number, "Expected a locale such as zh-CN");
        this.project.locale = rest;
        continue;
      }
      break;
    }
  }

  /**
   * Older files start with a `variables:` section. Variables are declared at
   * run time now, so the section is dropped with a warning instead of failing.
   */
  private skipLegacyVariables(): void {
    if (this.index >= this.lines.length) return;
    const line = this.lines[this.index]!;
    if (line.indent !== 0 || line.text !== "variables:") return;
    this.index += 1;
    while (this.index < this.lines.length && this.lines[this.index]!.indent > 0) this.index += 1;
    this.warnings.push("Ignored the legacy variables section; declare variables at run time instead");
  }

  private parseScript(): BlockNode {
    const line = this.lines[this.index]!;
    if (line.indent !== 0) fail(line.number, "Scripts must start at column 0");
    if (line.text === "start:") {
      this.index += 1;
      const node = createBlock("control.start");
      this.parseBody(node, "body", 0);
      return node;
    }
    if (line.text.startsWith("define ")) return this.parseDefine(line);
    if (line.text.startsWith("import ") || line.text.startsWith("from ")) return this.parseImport(line);
    fail(line.number, "Top-level blocks must be a `start:`, `define` or `import` hat");
  }

  private parseDefine(line: Line): BlockNode {
    const match = /^define\s+(value|action|function)\s+([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)\s*(?:->\s*([\w-]+))?:$/u.exec(line.text);
    if (!match) fail(line.number, "Expected `define value name(params) -> type:`");
    this.index += 1;
    const flavor = match[1]!;
    const name = match[2]!;
    const rawParams = match[3]!;
    const returnType = match[4];
    const parsed = parseParams(rawParams);
    if (parsed.errors.length > 0) fail(line.number, parsed.errors[0]!);
    const type =
      flavor === "value" ? FUNCTION_DEFINE_VALUE_TYPE : flavor === "action" ? FUNCTION_DEFINE_ACTION_TYPE : FUNCTION_DEFINE_TYPE;
    const fields: Record<string, FieldValue> = { name, params: formatParams(parsed.params) };
    if (type !== FUNCTION_DEFINE_ACTION_TYPE) {
      if (returnType !== undefined && !VALUE_TYPES.includes(returnType as ValueType)) fail(line.number, `Unknown return type: ${returnType}`);
      fields.returnType = returnType ?? "any";
    } else if (returnType !== undefined) {
      fail(line.number, "Action functions cannot return a value");
    }
    const node = createBlock(type, { fields });
    for (const param of parsed.params) this.params.add(param.name);
    this.parseBody(node, "body", 0);
    for (const param of parsed.params) this.params.delete(param.name);
    return node;
  }

  private parseImport(line: Line): BlockNode {
    this.index += 1;
    let match = /^import\s+(.+)$/.exec(line.text);
    if (match) {
      const path = this.parsePath(match[1]!, line.number);
      return createBlock(IMPORT_ALL_TYPE, { fields: { file: path } });
    }
    match = /^from\s+(.+?)\s+import\s+([\p{L}_][\p{L}\p{N}_]*)(?:\s+as\s+([\p{L}_][\p{L}\p{N}_]*))?$/u.exec(line.text);
    if (!match) fail(line.number, 'Expected `import "file"` or `from "file" import name`');
    const path = this.parsePath(match[1]!, line.number);
    if (match[3]) {
      return createBlock(IMPORT_ALIAS_TYPE, { fields: { file: path, name: match[2]!, alias: match[3]! } });
    }
    return createBlock(IMPORT_NAMED_TYPE, { fields: { file: path, name: match[2]! } });
  }

  /** Label names are bare words, or quoted strings when they contain spaces. */
  private parseName(text: string, line: number): string {
    const raw = text.trim();
    if (raw.startsWith('"')) {
      const expression = parseExpression(raw, line);
      if (expression.kind !== "literal" || typeof expression.value !== "string") {
        fail(line, "Label name must be a string");
      }
      return expression.value;
    }
    if (raw === "") fail(line, "Label name cannot be empty");
    return raw;
  }

  private parsePath(text: string, line: number): string {
    const expression = parseExpression(text, line);
    if (expression.kind !== "literal" || typeof expression.value !== "string") fail(line, "Import path must be a string");
    return expression.value;
  }

  private parseStack(indent: number): BlockNode[] {
    const nodes: BlockNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]!;
      if (line.indent < indent) break;
      if (line.indent > indent) fail(line.number, "Unexpected indentation");
      nodes.push(this.parseStatement(line));
    }
    return nodes;
  }

  private parseBody(node: BlockNode, port: string, parentIndent: number): void {
    if (this.index >= this.lines.length) return;
    const next = this.lines[this.index]!;
    if (next.indent <= parentIndent) return;
    const children = this.parseStack(next.indent);
    node.inputs = { ...(node.inputs ?? {}), [port]: children };
  }

  private parseStatement(line: Line): BlockNode {
    const text = line.text;
    const indent = line.indent;

    if (text.startsWith("raw ")) {
      this.index += 1;
      return rawNode(text.slice(4), line.number);
    }

    if (/^label\s+/.test(text)) {
      this.index += 1;
      return createBlock("control.label", { fields: { name: this.parseName(text.slice(6), line.number) } });
    }
    if (/^goto\s+/.test(text)) {
      this.index += 1;
      return createBlock("control.goto", { fields: { name: this.parseName(text.slice(5), line.number) } });
    }
    if (text === "break") {
      this.index += 1;
      return createBlock("control.break");
    }
    if (text === "pass") {
      this.index += 1;
      return createBlock("control.pass");
    }
    if (text === "forever:") {
      this.index += 1;
      const node = createBlock("control.forever");
      this.parseBody(node, "body", indent);
      return node;
    }
    if (text === "try:") {
      this.index += 1;
      const node = createBlock("control.try");
      this.parseBody(node, "body", indent);
      const catches: BlockNode[] = [];
      while (this.index < this.lines.length) {
        const next = this.lines[this.index]!;
        if (next.indent !== indent || !next.text.startsWith("catch")) break;
        this.index += 1;
        const match = /^catch(?:\s+(.+?))?(?:\s+as\s+([\p{L}_][\p{L}\p{N}_]*))?:$/u.exec(next.text);
        if (!match) fail(next.number, "Expected `catch:`, `catch type:` or `catch type as name:`");
        const filter = match[1]?.trim();
        const target = match[2];
        if (filter !== undefined && !["any", "error", "text", "number", "boolean", "list", "dict"].includes(filter)) {
          fail(next.number, `Unknown exception filter: ${filter}`);
        }
        let node: BlockNode;
        if (target) {
          node = createBlock("control.catchAssign", { fields: { exception: filter ?? "error", target } });
        } else if (filter !== undefined) {
          node = createBlock("control.catchType", { fields: { exception: filter } });
        } else {
          node = createBlock("control.catch");
        }
        this.parseBody(node, "body", indent);
        catches.push(node);
      }
      if (catches.length > 0) node.inputs = { ...(node.inputs ?? {}), catches };
      return node;
    }
    if (text.startsWith("if ") && text.endsWith(":")) {
      this.index += 1;
      const node = createBlock("control.if", { fields: { elseIfs: 0 } });
      this.assign(node, "condition", parseExpression(text.slice(3, -1), line.number));
      this.parseBody(node, "then", indent);
      let count = 0;
      while (this.index < this.lines.length) {
        const next = this.lines[this.index]!;
        if (next.indent !== indent) break;
        const elseIf = /^else\s+if\s+(.+):$/.exec(next.text);
        if (elseIf) {
          this.index += 1;
          count += 1;
          this.assign(node, `elseIf${count}`, parseExpression(elseIf[1]!, next.number));
          this.parseBody(node, `elseIf${count}Body`, indent);
          continue;
        }
        if (next.text === "else:") {
          this.index += 1;
          this.parseBody(node, "else", indent);
        }
        break;
      }
      node.fields = {
        ...(node.fields ?? {}),
        // Extension value: 0 = plain if, 1 = if/else, N = if + (N-1) else-if + else.
        elseIfs: count > 0 || node.inputs?.else !== undefined ? count + 1 : 0,
      };
      return node;
    }
    if (text.startsWith("while ") && text.endsWith(":")) {
      this.index += 1;
      const node = createBlock("control.while");
      this.assign(node, "condition", parseExpression(text.slice(6, -1), line.number));
      this.parseBody(node, "body", indent);
      return node;
    }
    if (text.startsWith("repeat ")) {
      const withMatch = /^repeat\s+with\s+([\p{L}_][\p{L}\p{N}_]*)\s+times\s+(.+):$/u.exec(text);
      if (withMatch) {
        this.index += 1;
        const node = createBlock("control.repeatWith", { fields: { variable: withMatch[1]! } });
        this.assign(node, "times", parseExpression(withMatch[2]!, line.number));
        this.parseBody(node, "body", indent);
        return node;
      }
      if (text.endsWith(":")) {
        this.index += 1;
        const node = createBlock("control.repeat");
        this.assign(node, "times", parseExpression(text.slice(7, -1), line.number));
        this.parseBody(node, "body", indent);
        return node;
      }
    }
    if (text.startsWith("print ")) {
      this.index += 1;
      const node = createBlock("io.print");
      this.assign(node, "text", parseExpression(text.slice(6), line.number));
      return node;
    }
    if (text.startsWith("wait ")) {
      this.index += 1;
      const node = createBlock("control.wait");
      this.assign(node, "seconds", parseExpression(text.slice(5), line.number));
      return node;
    }
    if (text.startsWith("throw ")) {
      this.index += 1;
      const node = createBlock("control.throw");
      this.assign(node, "value", parseExpression(text.slice(6), line.number));
      return node;
    }
    if (text.startsWith("exit ")) {
      this.index += 1;
      const node = createBlock("sys.exit");
      this.assign(node, "code", parseExpression(text.slice(5), line.number));
      return node;
    }
    if (text.startsWith("run ")) {
      this.index += 1;
      const node = createBlock("os.exec_command");
      this.assign(node, "command", parseExpression(text.slice(4), line.number));
      return node;
    }
    if (text === "return" || text.startsWith("return ")) {
      this.index += 1;
      const node = createBlock(FUNCTION_RETURN_TYPE);
      const rest = text.slice("return".length).trim();
      if (rest) this.assign(node, "value", parseExpression(rest, line.number));
      return node;
    }
    if (text.startsWith("note ")) {
      this.index += 1;
      const value = literalOf(parseExpression(text.slice(5), line.number), line.number);
      if (typeof value !== "string") fail(line.number, "A note needs a string");
      return createBlock("comment.note", { fields: { text: value } });
    }
    if (text.startsWith("create ")) {
      const created = /^create\s+([\p{L}_][\p{L}\p{N}_]*)(?:\s*:\s*([\w-]+))?\s+as\s+(.+)$/u.exec(text);
      if (!created) fail(line.number, "Expected `create name as value` or `create name: type as value`");
      this.index += 1;
      const type = created[2] ?? "any";
      if (!VALUE_TYPES.includes(type as ValueType)) fail(line.number, `Unknown type: ${type}`);
      const node = createBlock("var.create", { fields: { name: created[1]!, type } });
      this.assign(node, "value", parseExpression(created[3]!, line.number));
      return node;
    }
    if (text.startsWith("delete ")) {
      const name = this.parseName(text.slice(7), line.number);
      this.index += 1;
      return createBlock("var.delete", { fields: { name } });
    }
    if (text.startsWith("set ")) {
      const assignment = /^set\s+([\p{L}_][\p{L}\p{N}_]*)\s+to\s+(.+)$/u.exec(text);
      if (!assignment) fail(line.number, "Expected `set name to value`");
      this.index += 1;
      const node = createBlock("var.set", { fields: { variable: assignment[1]! } });
      this.assign(node, "value", parseExpression(assignment[2]!, line.number));
      return node;
    }
    if (text.startsWith("deletefile(") && text.endsWith(")")) {
      this.index += 1;
      const args = parseArguments(text.slice("deletefile(".length, -1), line.number);
      if (args.length !== 1) fail(line.number, "deletefile takes one argument");
      const node = createBlock("file.delete");
      this.assign(node, "path", args[0]!);
      return node;
    }
    if (text.startsWith("setitem(") && text.endsWith(")")) {
      this.index += 1;
      const args = parseArguments(text.slice("setitem(".length, -1), line.number);
      if (args.length !== 3) fail(line.number, "setitem takes three arguments");
      const node = createBlock("list.set");
      this.assign(node, "items", args[0]!);
      this.assign(node, "index", args[1]!);
      this.assign(node, "value", args[2]!);
      return node;
    }
    if (text.startsWith("setkey(") && text.endsWith(")")) {
      this.index += 1;
      const args = parseArguments(text.slice("setkey(".length, -1), line.number);
      if (args.length !== 3) fail(line.number, "setkey takes three arguments");
      const node = createBlock("dict.set");
      this.assign(node, "dict", args[0]!);
      this.assign(node, "key", args[1]!);
      this.assign(node, "value", args[2]!);
      return node;
    }
    if (text.startsWith("add(") && text.endsWith(")")) {
      this.index += 1;
      const args = parseArguments(text.slice("add(".length, -1), line.number);
      if (args.length !== 2) fail(line.number, "add takes two arguments");
      const node = createBlock("list.add");
      this.assign(node, "items", args[0]!);
      this.assign(node, "value", args[1]!);
      return node;
    }
    if (text.startsWith("writefile(") && text.endsWith(")")) {
      this.index += 1;
      const args = parseArguments(text.slice("writefile(".length, -1), line.number);
      if (args.length !== 2) fail(line.number, "writefile takes two arguments");
      const node = createBlock("file.write");
      this.assign(node, "path", args[0]!);
      this.assign(node, "content", args[1]!);
      return node;
    }
    const call = /^([\p{L}_][\p{L}\p{N}_]*)\s*\((.*)\)$/u.exec(text);
    if (call) {
      this.index += 1;
      const args = parseArguments(call[2]!, line.number);
      const node = createBlock(`func.call:${call[1]}`);
      this.pending.set(node.id, { name: call[1]!, args, line: line.number });
      return node;
    }
    fail(line.number, `Unknown statement: ${text.split(/\s+/)[0]}`);
  }

  private assign(node: BlockNode, port: string, expression: Expr): void {
    if (expression.kind === "literal") {
      const value = expression.value;
      if (value === null) return;
      if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
        node.inputs = { ...(node.inputs ?? {}), [port]: literalBlock(value) };
        return;
      }
      node.fields = { ...(node.fields ?? {}), [port]: value };
      return;
    }
    node.inputs = { ...(node.inputs ?? {}), [port]: this.toNode(expression) };
  }

  private toNode(expression: Expr): BlockNode {
    switch (expression.kind) {
      case "literal":
        throw new NblkFailure(0, "Internal: literal cannot be a block");
      case "name": {
        if (this.params.has(expression.name)) return createBlock(FUNCTION_PARAM_TYPE, { fields: { name: expression.name } });
        return createBlock("var.get", { fields: { variable: expression.name } });
      }
      case "index": {
        const node = createBlock("list.get");
        this.assign(node, "items", expression.target);
        this.assign(node, "index", expression.index);
        return node;
      }
      case "binary": {
        if (COMPARISONS.includes(expression.op as (typeof COMPARISONS)[number])) {
          const node = createBlock("logic.compare", { fields: { op: expression.op } });
          this.assign(node, "a", expression.left);
          this.assign(node, "b", expression.right);
          return node;
        }
        const node = createBlock("math.arithmetic", { fields: { op: expression.op } });
        this.assign(node, "a", expression.left);
        this.assign(node, "b", expression.right);
        return node;
      }
      case "unary": {
        if (expression.value.kind === "literal" && typeof expression.value.value === "number") {
          return createBlock("math.number", { fields: { value: -expression.value.value } });
        }
        const node = createBlock("math.arithmetic", { fields: { op: "*" } });
        this.assign(node, "a", expression.value);
        this.assign(node, "b", { kind: "literal", value: -1 });
        return node;
      }
      case "list":
        return createBlock("list.literal", { fields: { items: JSON.stringify(valueOfExpr(expression)) } });
      case "dict":
        return createBlock("dict.literal", { fields: { items: JSON.stringify(valueOfExpr(expression)) } });
      case "call":
        return this.callNode(expression);
      default:
        throw new Error("Unhandled expression");
    }
  }

  private callNode(expression: Extract<Expr, { kind: "call" }>): BlockNode {
    const { name, args } = expression;
    const arg = (index: number): Expr | undefined => args[index];
    const build = (type: string, fields: Record<string, FieldValue> | undefined, ports: string[]): BlockNode => {
      const node = createBlock(type, fields ? { fields } : {});
      ports.forEach((port, index) => {
        const value = arg(index);
        if (value) this.assign(node, port, value);
      });
      return node;
    };
    switch (name) {
      case "raw": {
        const value = arg(0);
        if (!value) fail(0, "raw() expects one JSON argument");
        const literal = valueOfExpr(value);
        const raw = rawNode(JSON.stringify(literal), 0, true);
        return raw;
      }
      case "join": {
        const node = createBlock("text.join", { fields: { count: Math.max(1, args.length) } });
        args.forEach((value, index) => this.assign(node, String.fromCharCode(97 + index), value));
        return node;
      }
      case "contains":
        return build("text.contains", undefined, ["text", "needle"]);
      case "split":
        return build("text.splitAt", undefined, ["text", "separator", "index"]);
      case "length":
        return build("list.length", undefined, ["items"]);
      case "getitem":
        return build("list.get", undefined, ["items", "index"]);
      case "getkey":
        return build("dict.get", undefined, ["dict", "key"]);
      case "haskey":
        return build("dict.has", undefined, ["dict", "key"]);
      case "keysof":
        return build("dict.keys", undefined, ["dict"]);
      case "toNumber":
        return build("convert.toNumber", undefined, ["text"]);
      case "toString":
        return build("convert.toString", undefined, ["value"]);
      case "readfile":
        return build("file.read", undefined, ["path"]);
      case "exists":
        return build("file.exists", undefined, ["path"]);
      case "listfiles":
        return build("file.list", undefined, []);
      case "time":
        return createBlock("time.get_os_time");
      default: {
        const node = createBlock(`func.call:${name}`);
        this.pending.set(node.id, { name, args, line: 0 });
        return node;
      }
    }
  }

  private resolveCalls(): void {
    const decls = collectFunctions(this.project.scripts);
    const byName = new Map<string, (typeof decls)[number]>();
    for (const decl of decls) {
      if (byName.has(decl.name)) fail(0, `Duplicate function: ${decl.name}`);
      byName.set(decl.name, decl);
    }
    for (const [id, pending] of this.pending) {
      const decl = byName.get(pending.name);
      const unresolved = decl === undefined;
      if (unresolved) {
        let node: BlockNode | undefined;
        this.findNode(id, (candidate) => {
          node = candidate;
        });
        if (!node) continue;
        node.type = functionNameCallType(pending.name);
        pending.args.forEach((value, index) => this.assign(node!, `arg${index}`, value));
        continue;
      }
      if (pending.args.length > decl.params.length) {
        fail(pending.line, `Too many arguments for ${pending.name} (expected ${decl.params.length})`);
      }
      let node: BlockNode | undefined;
      this.findNode(id, (candidate) => {
        node = candidate;
      });
      if (!node) continue;
      node.type = functionCallType(decl.id);
      pending.args.forEach((value, index) => {
        this.assign(node!, decl.params[index]!.name, value);
      });
    }
  }

  private findNode(id: string, visit: (node: BlockNode) => void): void {
    const stack: BlockNode[] = [...this.project.scripts];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.id === id) {
        visit(node);
        return;
      }
      for (const value of Object.values(node.inputs ?? {})) {
        if (Array.isArray(value)) stack.push(...value);
        else stack.push(value);
      }
    }
  }
}

interface PrintContext {
  project: Project;
  schemas?: NblkSchemaSource;
  functions: Map<string, { name: string; params: string[]; returnType: string; kind: "value" | "action" }>;
}

/** Read a name-typed field, tolerating older documents that stored ids. */
function variableNameOf(node: BlockNode, field: string): string {
  return String(node.fields?.[field] ?? "") || "variable";
}

function rawNode(raw: string, line: number, expression = false): BlockNode {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new NblkFailure(line, expression ? "raw() expects JSON" : "raw expects JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NblkFailure(line, "raw block must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.type !== "string" || record.type.length === 0) {
    throw new NblkFailure(line, "raw block needs a type");
  }
  const node = createBlock(record.type);
  if (typeof record.id === "string") node.id = record.id;
  if (record.fields !== undefined) {
    if (typeof record.fields !== "object" || record.fields === null) throw new NblkFailure(line, "raw fields must be an object");
    node.fields = record.fields as Record<string, FieldValue>;
  }
  if (record.inputs !== undefined) {
    if (typeof record.inputs !== "object" || record.inputs === null) throw new NblkFailure(line, "raw inputs must be an object");
    node.inputs = record.inputs as Record<string, BlockNode | BlockNode[]>;
  }
  return node;
}

/** Exception filters keep their English ids in the document but print in Chinese. */
const ZH_EXCEPTIONS: Record<string, string> = {
  any: "任意",
  error: "错误",
  text: "文本",
  number: "数字",
  boolean: "布尔值",
  list: "列表",
  dict: "字典",
};

function zhException(filter: string): string {
  return ZH_EXCEPTIONS[filter] ?? filter;
}

/** Function parameter list, printed with Chinese type names. */
function paramsToZh(params: string): string {
  return params
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const colon = entry.indexOf(":");
      if (colon === -1) return entry;
      return `${entry.slice(0, colon).trim()}: ${typeToZh(entry.slice(colon + 1).trim())}`;
    })
    .join(", ");
}

function literalText(value: FieldValue): string {
  if (typeof value === "boolean") return value ? "真" : "假";
  return JSON.stringify(value);
}

function expressionText(node: BlockNode, context: PrintContext): string {
  const child = (value: BlockNode): string => {
    const text = expressionText(value, context);
    return value.type === "math.arithmetic" || value.type === "logic.compare" ? `(${text})` : text;
  };
  if (node.type === FUNCTION_PARAM_TYPE) return String(node.fields?.name ?? "param");
  if (node.type === "var.get") return variableNameOf(node, "variable");
  if (node.type === "text.literal") return literalText(String(node.fields?.value ?? ""));
  if (node.type === "math.number") return literalText(Number(node.fields?.value ?? 0));
  if (node.type === "logic.boolean") return Boolean(node.fields?.value) ? "真" : "假";
  if (node.type === "math.arithmetic") {
    const op = String(node.fields?.op ?? "+");
    return `${portValue(node, "a", "number", context)} ${op} ${portValue(node, "b", "number", context)}`;
  }
  if (node.type === "logic.compare") {
    const op = String(node.fields?.op ?? "==");
    return `${portValue(node, "a", "any", context)} ${op} ${portValue(node, "b", "any", context)}`;
  }
  if (node.type === "text.contains") {
    return `包含(${portValue(node, "text", "text", context)}, ${portValue(node, "needle", "text", context)})`;
  }
  if (node.type === "text.splitAt") {
    return `拆分(${portValue(node, "text", "text", context)}, ${portValue(node, "separator", "text", context)}, ${portValue(node, "index", "number", context)})`;
  }
  if (node.type === "text.join") {
    const count = Math.max(1, Number(node.fields?.count ?? 2));
    const parts: string[] = [];
    for (let index = 0; index < count; index += 1) {
      parts.push(portValue(node, String.fromCharCode(97 + index), "text", context));
    }
    return `连接(${parts.join(", ")})`;
  }
  if (node.type === "list.length") return `长度(${portValue(node, "items", "list", context)})`;
  if (node.type === "list.get") {
    const items = node.inputs?.items;
    return `取元素(${items && !Array.isArray(items) ? expressionText(items, context) : "[]"}, ${portValue(node, "index", "number", context)})`;
  }
  if (node.type === "list.literal") return compactJson(String(node.fields?.items ?? "[]"), node);
  if (node.type === "dict.get") return `取值(${portValue(node, "dict", "dict", context)}, ${portValue(node, "key", "text", context)})`;
  if (node.type === "dict.has") return `有键(${portValue(node, "dict", "dict", context)}, ${portValue(node, "key", "text", context)})`;
  if (node.type === "dict.keys") return `键列表(${portValue(node, "dict", "dict", context)})`;
  if (node.type === "dict.literal") return compactJson(String(node.fields?.items ?? "{}"), node);
  if (node.type === "convert.toNumber") return `转数字(${portValue(node, "text", "text", context)})`;
  if (node.type === "convert.toString") return `转文本(${portValue(node, "value", "any", context)})`;
  if (node.type === "file.read") return `读取文件(${portValue(node, "path", "text", context)})`;
  if (node.type === "file.exists") return `存在(${portValue(node, "path", "text", context)})`;
  if (node.type === "file.list") return "列出文件()";
  if (node.type === "time.get_os_time") return "当前时间()";
  if (node.type.startsWith("func.call:")) {
    const decl = context.functions.get(node.type.slice("func.call:".length));
    if (decl) {
      const args = decl.params.map((param) => portValue(node, param, "any", context));
      return `${decl.name}(${args.join(", ")})`;
    }
    const schema = context.schemas?.get(node.type);
    if (schema) {
      const args = (schema.ports ?? []).map((port) => portValue(node, port.name, port.type ?? "any", context));
      return `${schema.label}(${args.join(", ")})`;
    }
    return rawText(node);
  }
  return rawText(node);
}

function compactJson(raw: string, node: BlockNode): string {
  try {
    return inlineJson(JSON.parse(raw) as Value);
  } catch {
    return rawText(node);
  }
}

function inlineJson(value: Value): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(0, "Non-finite number in document");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "真" : "假";
  if (value === null) return "空";
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(", ")}]`;
  return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${inlineJson(item)}`).join(", ")}}`;
}

function rawText(node: BlockNode): string {
  return `原始(${JSON.stringify(node)})`;
}

function portValue(node: BlockNode, port: string, type: ValueType, context: PrintContext): string {
  const literal = node.fields?.[port];
  if (literal !== undefined) return literalText(literal);
  const input = node.inputs?.[port];
  if (input && !Array.isArray(input)) return expressionText(input, context);
  const fallback = defaultValue(type);
  return literalText(typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean" ? fallback : "");
}

function stackLines(node: BlockNode, port: string, context: PrintContext): string[] {
  const value = node.inputs?.[port];
  const stack = Array.isArray(value) ? value : [];
  return stack.flatMap((child) => renderBlock(child, context));
}

function printBlock(node: BlockNode, indent: number, context: PrintContext): string[] {
  const pad = " ".repeat(indent);
  return renderBlock(node, context).map((line) => pad + line);
}

function renderBlock(node: BlockNode, context: PrintContext): string[] {
  const body = (port: string): string[] => stackLines(node, port, context).map((line) => "  " + line);
  switch (node.type) {
    case "control.start":
      return [`开始:`, ...body("body")];
    case FUNCTION_DEFINE_VALUE_TYPE:
    case FUNCTION_DEFINE_ACTION_TYPE:
    case FUNCTION_DEFINE_TYPE: {
      const name = String(node.fields?.name ?? "function");
      const params = String(node.fields?.params ?? "");
      if (node.type === FUNCTION_DEFINE_ACTION_TYPE) return [`定义操作 ${name}(${paramsToZh(params)}):`, ...body("body")];
      const keyword = node.type === FUNCTION_DEFINE_TYPE ? "函数" : "取值";
      const returnType = typeToZh(String(node.fields?.returnType ?? "any"));
      return [`定义${keyword} ${name}(${paramsToZh(params)}) -> ${returnType}:`, ...body("body")];
    }
    case IMPORT_ALL_TYPE:
      return [`导入 ${JSON.stringify(String(node.fields?.file ?? ""))}`];
    case IMPORT_NAMED_TYPE:
      return [`从 ${JSON.stringify(String(node.fields?.file ?? ""))} 导入 ${String(node.fields?.name ?? "")}`];
    case IMPORT_ALIAS_TYPE:
      return [
        `从 ${JSON.stringify(String(node.fields?.file ?? ""))} 导入 ${String(node.fields?.name ?? "")} 作为 ${String(node.fields?.alias ?? "")}`,
      ];
    case "control.if": {
      const lines = [`如果 ${portValue(node, "condition", "boolean", context)}:`];
      lines.push(...body("then"));
      const count = Math.max(0, Number(node.fields?.elseIfs ?? 0) - 1);
      for (let index = 1; index <= count; index += 1) {
        lines.push(`否则如果 ${portValue(node, `elseIf${index}`, "boolean", context)}:`);
        lines.push(...body(`elseIf${index}Body`));
      }
      if (node.inputs?.else !== undefined) {
        lines.push("否则:");
        lines.push(...body("else"));
      }
      return lines;
    }
    case "control.repeat":
      return [`重复 ${portValue(node, "times", "number", context)} 次:`, ...body("body")];
    case "control.repeatWith":
      return [
        `重复 使用 ${variableNameOf(node, "variable")} 共 ${portValue(node, "times", "number", context)} 次:`,
        ...body("body"),
      ];
    case "control.while":
      return [`当 ${portValue(node, "condition", "boolean", context)}:`, ...body("body")];
    case "control.forever":
      return [`无限重复:`, ...body("body")];
    case "control.wait":
      return [`等待 ${portValue(node, "seconds", "number", context)} 秒`];
    case "control.label":
      return [`标记 ${nameField(node)}`];
    case "control.goto":
      return [`跳转到 ${nameField(node)}`];
    case "control.break":
      return ["跳出循环"];
    case "control.pass":
      return ["跳过"];
    case "control.throw":
      return [`抛出 ${portValue(node, "value", "any", context)}`];
    case "control.try": {
      const lines = ["尝试:", ...body("body")];
      const catchers = node.inputs?.catches;
      if (Array.isArray(catchers)) {
        for (const catcher of catchers) {
          if (catcher.type === "control.catch") lines.push("捕获:");
          else if (catcher.type === "control.catchType") lines.push(`捕获 ${zhException(String(catcher.fields?.exception ?? "error"))}:`);
          else if (catcher.type === "control.catchAssign") {
            const target = String(catcher.fields?.target ?? "error");
            lines.push(`捕获 ${zhException(String(catcher.fields?.exception ?? "error"))} 作为 ${target}:`);
          } else {
            lines.push(...renderBlock(catcher, context));
            continue;
          }
          lines.push(...stackLines(catcher, "body", context).map((line) => "  " + line));
        }
      }
      return lines;
    }
    case "sys.exit":
      return [`退出程序 ${portValue(node, "code", "number", context)}`];
    case FUNCTION_RETURN_TYPE: {
      const value = node.fields?.value;
      const input = node.inputs?.value;
      if (value !== undefined) return [`返回 ${literalText(value)}`];
      if (input && !Array.isArray(input)) return [`返回 ${expressionText(input, context)}`];
      return ["返回"];
    }
    case "io.print":
      return [`打印 ${portValue(node, "text", "any", context)}`];
    case "var.create": {
      const type = String(node.fields?.type ?? "any");
      const suffix = type === "any" ? "" : `: ${typeToZh(type)}`;
      return [`创建变量 ${String(node.fields?.name ?? "name")}${suffix} 为 ${portValue(node, "value", "any", context)}`];
    }
    case "var.delete":
      return [`删除变量 ${String(node.fields?.name ?? "name")}`];
    case "var.set":
      return [`设置 ${variableNameOf(node, "variable")} 为 ${portValue(node, "value", "any", context)}`];
    case "list.set":
      return [
        `设置元素(${portValue(node, "items", "list", context)}, ${portValue(node, "index", "number", context)}, ${portValue(node, "value", "any", context)})`,
      ];
    case "list.add":
      return [`添加(${portValue(node, "items", "list", context)}, ${portValue(node, "value", "any", context)})`];
    case "dict.set":
      return [
        `设置键(${portValue(node, "dict", "dict", context)}, ${portValue(node, "key", "text", context)}, ${portValue(node, "value", "any", context)})`,
      ];
    case "file.write":
      return [`写入文件(${portValue(node, "path", "text", context)}, ${portValue(node, "content", "any", context)})`];
    case "file.delete":
      return [`删除文件(${portValue(node, "path", "text", context)})`];
    case "os.exec_command":
      return [`执行命令 ${portValue(node, "command", "text", context)}`];
    case "comment.note":
      return [`注释 ${literalText(String(node.fields?.text ?? ""))}`];
    case "control.catch":
    case "control.catchType":
    case "control.catchAssign":
      return [`原始 ${JSON.stringify(node)}`];
    default: {
      if (node.type.startsWith("func.call:")) {
        const decl = context.functions.get(node.type.slice("func.call:".length));
        if (decl) {
          const args = decl.params.map((param) => portValue(node, param, "any", context));
          return [`${decl.name}(${args.join(", ")})`];
        }
        const schema = context.schemas?.get(node.type);
        if (schema) {
          const args = (schema.ports ?? []).map((port) => portValue(node, port.name, port.type ?? "any", context));
          return [`${schema.label}(${args.join(", ")})`];
        }
      }
      return printGeneric(node, context);
    }
  }
}

function printGeneric(node: BlockNode, _context: PrintContext): string[] {
  return [`原始 ${JSON.stringify(node)}`];
}

/** Render a document as `.nblk` text. Schemas improve dynamic ports. */
export function printNblk(document: NexusDocument, schemas?: NblkSchemaSource): string {
  const project = document.project;
  const functions = new Map<string, { name: string; params: string[]; returnType: string; kind: "value" | "action" }>();
  for (const decl of collectFunctions(project.scripts)) {
    functions.set(decl.id, {
      name: decl.name,
      params: decl.params.map((param) => param.name),
      returnType: decl.returnType,
      kind: decl.kind,
    });
  }
  const context: PrintContext = {
    project,
    schemas,
    functions,
  };
  const lines: string[] = [];
  lines.push(`项目 ${JSON.stringify(project.name)}`);
  lines.push(`语言 ${project.locale}`);
  if (project.scripts.length > 0) lines.push("");
  project.scripts.forEach((script, index) => {
    const previous = project.scripts[index - 1];
    const bothImports = previous !== undefined && isImportType(previous.type) && isImportType(script.type);
    if (index > 0 && !bothImports) lines.push("");
    lines.push(...printBlock(script, 0, context));
  });
  return `${lines.join("\n")}\n`;
}

/** Parse `.nblk` text into a document. */
export function parseNblk(source: string): NblkParseResult {
  try {
    const parser = new Parser(source);
    const document = parser.parse();
    return { ok: true, document, warnings: [...parser.warnings] };
  } catch (error) {
    if (error instanceof NblkFailure) {
      return { ok: false, error: { line: error.line, message: error.message } };
    }
    throw error;
  }
}

/** Print a label name bare unless whitespace or quotes would break parsing. */
function nameField(node: BlockNode): string {
  const name = String(node.fields?.name ?? "label");
  return /^[^\s"\\]+$/.test(name) ? name : JSON.stringify(name);
}
