export type Attrs = Record<string, string | number | boolean | null | undefined>;

export interface ElOptions {
  class?: string;
  text?: string;
  html?: string;
  attrs?: Attrs;
  dataset?: Record<string, string>;
  /** Inline styles; camelCase properties plus `--custom-properties` are supported. */
  style?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void };
}

/** Tiny hyperscript helper: no framework, but predictable DOM creation. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) node.dataset[key] = value;
  }
  if (options.style) {
    for (const [property, value] of Object.entries(options.style)) {
      if (property.startsWith("--")) node.style.setProperty(property, value);
      else (node.style as unknown as Record<string, string>)[property] = value;
    }
  }
  if (options.on) {
    for (const [key, handler] of Object.entries(options.on)) {
      if (handler) node.addEventListener(key, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function closest<T extends Element>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? (target.closest(selector) as T | null) : null;
}

/** Read a `data-*` attribute as a string, or `null` when absent. */
export function data(node: Element, key: string): string | null {
  return node.getAttribute(`data-${key}`);
}
