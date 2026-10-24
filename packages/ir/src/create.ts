import { createId } from "./ids.ts";
import {
  DOCUMENT_FORMAT,
  DOCUMENT_VERSION,
  IR_FORMAT,
  IR_VERSION,
  type BlockNode,
  type NexusDocument,
  type Project,
  type Value,
} from "./model.ts";

export interface ProjectOptions {
  name?: string;
  locale?: string;
}

/** Create an empty project with no scripts. */
export function createProject(options: ProjectOptions = {}): Project {
  const now = new Date().toISOString();
  return {
    format: IR_FORMAT,
    version: IR_VERSION,
    id: createId("p"),
    name: options.name ?? "Untitled",
    locale: options.locale ?? "zh-CN",
    createdAt: now,
    updatedAt: now,
    functions: [],
    scripts: [],
    metadata: {},
  };
}

export function createDocument(project: Project): NexusDocument {
  return {
    format: DOCUMENT_FORMAT,
    version: DOCUMENT_VERSION,
    project,
  };
}

export interface BlockInit {
  id?: string;
  fields?: Record<string, string | number | boolean>;
  inputs?: Record<string, BlockNode | BlockNode[]>;
}

export function createBlock(type: string, init: BlockInit = {}): BlockNode {
  const node: BlockNode = { id: init.id ?? createId(), type };
  if (init.fields) node.fields = { ...init.fields };
  if (init.inputs) node.inputs = { ...init.inputs };
  return node;
}

/** Refresh `updatedAt` without touching anything else. */
export function touchProject(project: Project): Project {
  return { ...project, updatedAt: new Date().toISOString() };
}

/**
 * A tiny starter program: `print("Hello, world!")` behind a start hat. Used by
 * the editor for new projects and by end-to-end tests.
 */
export function createHelloWorldScript(): BlockNode {
  return createBlock("control.start", {
    inputs: {
      body: [
        createBlock("io.print", {
          inputs: {
            text: createBlock("text.literal", { fields: { value: "Hello, world!" } }),
          },
        }),
      ],
    },
  });
}
