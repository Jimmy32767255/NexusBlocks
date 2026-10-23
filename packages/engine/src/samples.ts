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

/** Starter document with the hello-world script. */
export function createStarterDocument(locale = "zh-CN"): NexusDocument {
  return createDocument(createHelloWorldProject(locale));
}
