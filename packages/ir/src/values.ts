import type { Value, ValueType } from "./model.ts";

/** Classify a runtime value. `null` is treated as `any` (untyped empty). */
export function typeOf(value: Value): ValueType {
  if (value === null) return "any";
  if (Array.isArray(value)) return "list";
  switch (typeof value) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "dict";
    default:
      return "any";
  }
}

export function isAssignable(from: ValueType, to: ValueType): boolean {
  if (to === "any" || from === "any") return true;
  if (from === "void" || to === "void") return from === to;
  if (from === to) return true;
  // Text is the universal display format, so anything may flow into a text port.
  if (to === "text" && (from === "number" || from === "boolean")) return true;
  return false;
}

export function defaultValue(type: ValueType): Value {
  switch (type) {
    case "text":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "dict":
      return {};
    default:
      return null;
  }
}

export type CoercionResult =
  | { ok: true; value: Value }
  | { ok: false; reason: "type" | "number" | "text" };

/** Convert a value to the requested port type, following language rules. */
export function coerce(value: Value, to: ValueType): CoercionResult {
  if (to === "any" || to === "void") return { ok: true, value };
  const from = typeOf(value);
  if (from === to) return { ok: true, value };

  switch (to) {
    case "text":
      return { ok: true, value: toDisplayText(value) };
    case "number": {
      if (typeof value === "boolean") return { ok: true, value: value ? 1 : 0 };
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") return { ok: true, value: 0 };
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) return { ok: false, reason: "number" };
        return { ok: true, value: parsed };
      }
      return { ok: false, reason: "type" };
    }
    case "boolean": {
      if (typeof value === "number") return { ok: true, value: value !== 0 };
      if (typeof value === "string") {
        return { ok: true, value: value !== "" && value !== "false" && value !== "0" };
      }
      if (value === null) return { ok: true, value: false };
      return { ok: true, value: true };
    }
    case "list":
      if (Array.isArray(value)) return { ok: true, value };
      return { ok: false, reason: "type" };
    case "dict":
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        return { ok: true, value: value as { [key: string]: Value } };
      }
      return { ok: false, reason: "type" };
    default:
      return { ok: false, reason: "type" };
  }
}

/** Human-readable rendering used by the console and by text coercion. */
export function toDisplayText(value: Value): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(toDisplayText).join(", ")}]`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function valuesEqual(a: Value, b: Value): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) {
    if (typeof a === "number" && typeof b === "string") return a === Number(b);
    if (typeof b === "number" && typeof a === "string") return b === Number(a);
    return false;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => valuesEqual(item, b[index] ?? null));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      valuesEqual(
        (a as { [key: string]: Value })[key] ?? null,
        (b as { [key: string]: Value })[key] ?? null,
      ),
    );
  }
  return false;
}

/** Language truthiness: false, 0, "", null and empty containers are falsy. */
export function truthy(value: Value): boolean {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value !== "";
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value).length > 0;
}
