import {
  createDocument,
  createHelloWorldScript,
  createProject,
  type NexusDocument,
  type Project,
} from "@nexus/ir";

/** A runnable "Hello, world!" project, used for new files and smoke tests. */
export function createHelloWorldProject(locale = "zh-CN"): Project {
  const project = createProject({ name: "Hello, world!", locale });
  project.scripts = [createHelloWorldScript()];
  return project;
}

/** Starter document with the hello-world script placed on the canvas. */
export function createStarterDocument(locale = "zh-CN"): NexusDocument {
  const document = createDocument(createHelloWorldProject(locale));
  const script = document.project.scripts[0];
  if (script) document.editor.positions[script.id] = { x: 80, y: 96 };
  return document;
}
