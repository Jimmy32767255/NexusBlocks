/**
 * Chinese keywords for `.nblk`.
 *
 * `.nblk` is printed with UTF-8 Chinese keywords so the text file reads like
 * the blocks do on screen. The parser still accepts the older English spelling,
 * which keeps existing files working: `localizeLine` rewrites a Chinese line to
 * the English canonical form before parsing.
 *
 * Only code outside string literals is rewritten, so a program that prints
 * `"如果"` still prints those characters.
 */
import type { ValueType } from "./model.ts";

/** Chinese type names, in the order used by type dropdowns. */
export const ZH_TYPES: Record<ValueType, string> = {
  any: "任意",
  void: "无",
  text: "文本",
  number: "数字",
  boolean: "布尔值",
  list: "列表",
  dict: "字典",
};

const TYPE_TO_ZH = ZH_TYPES;
const ZH_TO_TYPE = new Map(Object.entries(ZH_TYPES).map(([type, zh]) => [zh, type as ValueType]));

/** Type names printed for a value type. */
export function typeToZh(type: string): string {
  return TYPE_TO_ZH[type as ValueType] ?? type;
}

/** Translate a Chinese type name back to its canonical spelling. */
export function typeFromZh(name: string): ValueType | undefined {
  return ZH_TO_TYPE.get(name);
}

/** Expression-level builtin names and their Chinese spelling. */
export const ZH_CALLS: [zh: string, en: string][] = [
  // Text primitives come first: `文本长度(` contains `长度(`, so the longer
  // spelling must be rewritten before the shorter alias can match.
  ["解析JSON", "parsejson"],
  ["类型", "typeof"],
  ["转布尔", "toBoolean"],
  ["参数", "args"],
  ["移除", "remove"],
  ["并且", "and"],
  ["或者", "or"],
  ["文本长度", "textlength"],
  ["取字符", "charat"],
  ["子串", "substring"],
  ["查找", "indexof"],
  ["拆分为列表", "splitlist"],
  ["字符码", "charcode"],
  ["码转字符", "fromcharcode"],
  ["连接", "join"],
  ["包含", "contains"],
  ["拆分", "split"],
  ["长度", "length"],
  ["取元素", "getitem"],
  ["取值", "getkey"],
  ["有键", "haskey"],
  ["键列表", "keysof"],
  ["转数字", "toNumber"],
  ["转文本", "toString"],
  ["读取文件", "readfile"],
  ["存在", "exists"],
  ["列出文件", "listfiles"],
  ["当前时间", "time"],
  ["原始", "raw"],
  ["设置元素", "setitem"],
  ["设置键", "setkey"],
  ["添加", "add"],
  ["写入文件", "writefile"],
  ["删除文件", "deletefile"],
];

/** Literal spellings. */
const LITERALS: [zh: string, en: string][] = [
  ["真", "true"],
  ["假", "false"],
  ["空", "null"],
];

/** Replace matches outside double-quoted string literals. */
function mapOutsideStrings(text: string, map: (chunk: string) => string): string {
  let out = "";
  let chunk = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      out += char;
      if (char === "\\") {
        const next = text[index + 1];
        if (next !== undefined) {
          out += next;
          index += 1;
        }
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      out += map(chunk);
      chunk = "";
      out += char;
      inString = true;
      continue;
    }
    chunk += char;
  }
  out += map(chunk);
  return out;
}

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite Chinese builtin calls to their canonical names.
 *
 * A call only counts when the name starts a word: `节点类型(` must stay a user
 * function, not turn into `节点typeof(`.
 */
function replaceWords(text: string, pairs: [zh: string, en: string][], suffix = false): string {
  let out = text;
  for (const [zh, en] of pairs) {
    if (!suffix) {
      out = out.split(zh).join(en);
      continue;
    }
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapePattern(zh)}\\(`, "gu");
    out = out.replace(pattern, `${en}(`);
  }
  return out;
}

/** Rewrite a Chinese line into the English canonical form the parser reads. */
export function localizeLine(text: string): string {
  const indent = text.length - text.trimStart().length;
  const pad = text.slice(0, indent);
  const body = localizeStatement(text.slice(indent));
  return pad + localizeTail(body);
}

function localizeStatement(body: string): string {
  const rules: [RegExp, (match: RegExpExecArray) => string][] = [
    [/^项目\s+(.+)$/u, (m) => `project ${m[1]}`],
    [/^语言\s+(.+)$/u, (m) => `locale ${m[1]}`],
    [/^开始:$/u, () => "start:"],
    [/^定义取值\s+(.+)$/u, (m) => `define value ${localizeSignature(m[1]!)}`],
    [/^定义操作\s+(.+)$/u, (m) => `define action ${localizeSignature(m[1]!)}`],
    [/^定义函数\s+(.+)$/u, (m) => `define function ${localizeSignature(m[1]!)}`],
    [/^导入\s+(.+)$/u, (m) => `import ${m[1]}`],
    [/^从\s+(.+?)\s+导入\s+([\p{L}_][\p{L}\p{N}_]*)(?:\s+作为\s+([\p{L}_][\p{L}\p{N}_]*))?$/u, (m) =>
      `from ${m[1]} import ${m[2]}${m[3] ? ` as ${m[3]}` : ""}`],
    [/^标记\s+(.+)$/u, (m) => `label ${m[1]}`],
    [/^跳转到\s+(.+)$/u, (m) => `goto ${m[1]}`],
    [/^跳出循环$/u, () => "break"],
    [/^跳过$/u, () => "pass"],
    [/^无限重复:$/u, () => "forever:"],
    [/^尝试:$/u, () => "try:"],
    [/^捕获(?:[ \t]+(.+?))?(?:[ \t]+作为[ \t]+([\p{L}_][\p{L}\p{N}_]*))?:$/u, (m) =>
      `catch${m[1] ? ` ${zhTypes(m[1])}` : ""}${m[2] ? ` as ${m[2]}` : ""}:`],
    [/^否则如果[ \t]+(.+):$/u, (m) => `else if ${m[1]}:`],
    [/^否则:$/u, () => "else:"],
    [/^如果[ \t]+(.+):$/u, (m) => `if ${m[1]}:`],
    [/^对每项[ \t]+([\p{L}_][\p{L}\p{N}_]*)[ \t]+在[ \t]+(.+):$/u, (m) => `for each ${m[1]} in ${m[2]}:`],
    [/^当[ \t]+(.+):$/u, (m) => `while ${m[1]}:`],
    [/^重复[ \t]+使用[ \t]+([\p{L}_][\p{L}\p{N}_]*)[ \t]+共[ \t]+(.+)[ \t]+次:$/u, (m) =>
      `repeat with ${m[1]} times ${m[2]}:`],
    [/^重复[ \t]+(.+)[ \t]+次:$/u, (m) => `repeat ${m[1]}:`],
    [/^等待[ \t]+(.+)[ \t]+秒$/u, (m) => `wait ${m[1]}`],
    [/^打印[ \t]+(.+)$/u, (m) => `print ${m[1]}`],
    [/^抛出[ \t]+(.+)$/u, (m) => `throw ${m[1]}`],
    [/^退出程序[ \t]+(.+)$/u, (m) => `exit ${m[1]}`],
    [/^执行命令[ \t]+(.+)$/u, (m) => `run ${m[1]}`],
    [/^返回(?:[ \t]+(.+))?$/u, (m) => `return${m[1] ? ` ${m[1]}` : ""}`],
    [/^注释[ \t]+(.+)$/u, (m) => `note ${m[1]}`],
    [/^创建局部变量[ \t]+([\p{L}_][\p{L}\p{N}_]*)(?:[ \t]*:[ \t]*([^\s]+))?[ \t]+为[ \t]+(.+)$/u, (m) =>
      `create local ${m[1]}${m[2] ? `: ${zhTypes(m[2])}` : ""} as ${m[3]}`],
    [/^创建变量[ \t]+([\p{L}_][\p{L}\p{N}_]*)(?:[ \t]*:[ \t]*([^\s]+))?[ \t]+为[ \t]+(.+)$/u, (m) =>
      `create ${m[1]}${m[2] ? `: ${zhTypes(m[2])}` : ""} as ${m[3]}`],
    [/^删除变量[ \t]+(.+)$/u, (m) => `delete ${m[1]}`],
    [/^设置局部变量[ \t]+([\p{L}_][\p{L}\p{N}_]*)[ \t]+为[ \t]+(.+)$/u, (m) => `set local ${m[1]} to ${m[2]}`],
    [/^设置[ \t]+([\p{L}_][\p{L}\p{N}_]*)[ \t]+为[ \t]+(.+)$/u, (m) => `set ${m[1]} to ${m[2]}`],
    [/^原始[ \t]+(.+)$/u, (m) => `raw ${m[1]}`],
  ];
  for (const [pattern, rewrite] of rules) {
    const match = pattern.exec(body);
    if (match) return rewrite(match);
  }
  return body;
}

/**
 * Translate the type names inside a function signature, leaving the parameter
 * names and the surrounding syntax alone.
 */
function localizeSignature(text: string): string {
  const arrow = text.lastIndexOf("->");
  const head = (arrow === -1 ? text : text.slice(0, arrow)).trimEnd();
  const open = head.indexOf("(");
  const close = head.lastIndexOf(")");
  if (open === -1 || close < open) {
    const ret = arrow === -1 ? "" : ` -> ${zhTypes(text.slice(arrow + 2).trim())}`;
    return `${head}${ret}`;
  }
  const params = splitTopLevel(head.slice(open + 1, close))
    .map((param) => {
      const colon = param.indexOf(":");
      if (colon === -1) return param.trim();
      return `${param.slice(0, colon).trim()}: ${zhTypes(param.slice(colon + 1).trim())}`;
    })
    .filter((param) => param !== "");
  const ret = arrow === -1 ? "" : ` -> ${zhTypes(text.slice(arrow + 2).trim())}`;
  const tail = head.slice(close + 1);
  return `${head.slice(0, open).trim()}(${params.join(", ")})${tail}${ret}`;
}

/** Split a parameter list on commas that are not nested inside brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Replace a literal only when it stands alone, so identifiers such as `真值`
 * keep their names.
 */
function replaceLiterals(text: string): string {
  let out = text;
  for (const [zh, en] of LITERALS) {
    const pattern = new RegExp(`(^|[\\s(\\[,:{}])${zh}(?=$|[\\s)\\],:{}])`, "gu");
    out = out.replace(pattern, (_whole, prefix: string) => `${prefix}${en}`);
  }
  return out;
}

/** Statements written as a call, e.g. `添加(列表, 值)`. */
function localizeTail(body: string): string {
  return mapOutsideStrings(body, (chunk) => replaceLiterals(replaceWords(chunk, ZH_CALLS, true)));
}

/** Replace Chinese type names in a fragment, never inside identifiers. */
function zhTypes(text: string): string {
  let out = text;
  for (const [zh, type] of ZH_TO_TYPE) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapePattern(zh)}(?![\\p{L}\\p{N}_])`, "gu");
    out = out.replace(pattern, type);
  }
  return out;
}
