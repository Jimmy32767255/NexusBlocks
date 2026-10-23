import {
  findBlock,
  validateProject,
  type Diagnostic,
  type NexusDocument,
} from "@nexus/ir";
import { defaultRegistry, type BlockRegistry } from "@nexus/engine";

export type RunStatus = "idle" | "running" | "finished" | "stopped" | "error";

export interface LogEntry {
  id: number;
  time: number;
  level: "info" | "error";
  text: string;
  blockId?: string;
}

export interface EditorState {
  document: NexusDocument;
  selectedId: string | null;
  status: RunStatus;
  logs: LogEntry[];
  dirty: boolean;
  zoom: number;
}

const HISTORY_LIMIT = 100;

/**
 * Editor state container. Every mutation goes through `update`, which keeps an
 * undo snapshot; views re-render from a subscription, no diffing required.
 */
export class Store {
  private current: EditorState;
  private readonly listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private logSeq = 0;

  constructor(document: NexusDocument, options: { zoom?: number } = {}) {
    this.current = {
      document,
      selectedId: null,
      status: "idle",
      logs: [],
      dirty: false,
      zoom: options.zoom ?? 1,
    };
  }

  get state(): EditorState {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  replaceDocument(document: NexusDocument): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = { ...this.current, document, selectedId: null, dirty: false, status: "idle" };
    this.notify();
  }

  update(
    mutator: (document: NexusDocument) => void,
    options: { history?: boolean; dirty?: boolean } = {},
  ): void {
    const history = options.history ?? true;
    const dirty = options.dirty ?? true;
    const snapshot = history ? JSON.stringify(this.current.document) : null;
    const next = structuredClone(this.current.document);
    mutator(next);
    next.project.updatedAt = new Date().toISOString();
    if (snapshot !== null) this.pushHistory(snapshot);
    this.current = { ...this.current, document: next, dirty: this.current.dirty || dirty };
    this.notify();
  }

  /** Put a previously captured snapshot back without touching undo history. */
  restoreSnapshot(snapshot: string): void {
    this.current = { ...this.current, document: JSON.parse(snapshot) as NexusDocument };
    this.notify();
  }

  /** Record a snapshot taken before a batch of silent updates (e.g. a drag). */
  pushHistory(snapshot: string): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.redoStack.push(JSON.stringify(this.current.document));
    this.current = { ...this.current, document: JSON.parse(previous) as NexusDocument, dirty: true };
    this.afterHistory();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(JSON.stringify(this.current.document));
    this.current = { ...this.current, document: JSON.parse(next) as NexusDocument, dirty: true };
    this.afterHistory();
  }

  private afterHistory(): void {
    const selected = this.current.selectedId;
    if (selected && !findBlock(this.current.document.project, selected)) {
      this.current = { ...this.current, selectedId: null };
    }
    this.notify();
  }

  select(id: string | null): void {
    if (this.current.selectedId === id) return;
    this.current = { ...this.current, selectedId: id };
    this.notify();
  }

  setStatus(status: RunStatus): void {
    if (this.current.status === status) return;
    this.current = { ...this.current, status };
    this.notify();
  }

  pushLog(entry: Omit<LogEntry, "id" | "time">): void {
    const log: LogEntry = { ...entry, id: (this.logSeq += 1), time: Date.now() };
    const logs = [...this.current.logs, log];
    this.current = { ...this.current, logs: logs.slice(-500) };
    this.notify();
  }

  clearLogs(): void {
    this.current = { ...this.current, logs: [] };
    this.notify();
  }

  setZoom(zoom: number): void {
    const clamped = Math.min(2, Math.max(0.4, zoom));
    if (Math.abs(clamped - this.current.zoom) < 0.001) return;
    this.current = { ...this.current, zoom: clamped };
    this.notify();
  }

  setLocale(locale: string): void {
    this.update((document) => {
      document.project.locale = locale;
    });
  }

  markSaved(): void {
    this.current = { ...this.current, dirty: false };
    this.notify();
  }

  validate(registry: BlockRegistry = defaultRegistry): Diagnostic[] {
    return validateProject(this.current.document.project, registry);
  }
}
