# Nexus Blocks

English | [简体中文](README.md)

Nexus Blocks is an **extensible visual programming environment**: you build programs out of blocks, but underneath sits a complete modern language rather than a toy that can only animate sprites.

## Goals

- **Real language semantics**: variables, control flow, expressions, and value semantics. Every block maps to exactly one IR node; the visual and textual views are two presentations of the same semantics.
- **Extensible**: block definitions, capabilities, renderers, and language packs are independent. Adding a block never requires touching the editor core.
- **Ready for system integration**: at runtime, effects travel through a `HostBridge` as capability calls (files, processes, network, …). A desktop shell can grant them per capability. v0.1 only ships `console.print`, but the seam is already there.
- **Internationalised**: UI, block labels, runtime messages, and docs share one message catalogue (English and Simplified Chinese by default).
- **WebView first**: the editor is a plain static web app (vanilla TypeScript + Vite) that can be embedded in any WebView (Tauri, Electron, mobile).

## Status (v0.1)

Working today:

- A complete visual editor: toolbox, drag & drop with snapping, nested blocks, canvas pan/zoom, inspector, variables panel, console, problems panel, undo/redo, and local autosave.
- 26 built-in blocks across control/IO/logic/math/text/variables, plus waiting, lists and dictionaries, and function definitions/parameters. Every function definition also yields a dynamic call block.
- An interpreter with a step limit, cancellation, event stream (logs, output, status, errors), and variable scopes.
- English and Chinese UI, runtime messages, and program output in the project locale.
- `pnpm test` covers IR, i18n, engine, and editor logic (61 cases).

Not built yet (interfaces reserved): the desktop shell (Tauri), file/network/process capabilities, advanced list/dict operations such as iteration and removal, and code export.

## Layout

```
packages/ir      Language IR: data model, JSON serialisation, validation, traversal, samples
packages/engine  Block definitions & registry, interpreter, capability requests, runtime events
packages/i18n    Message catalogues and translator
apps/editor      Web editor (Vite + vanilla TypeScript)
docs/zh          Architecture, IR, blocks, i18n, roadmap (Chinese)
```

## Quick start

Requires Node.js 22+ and pnpm 10+.

```bash
pnpm install
pnpm dev        # editor at http://localhost:5173
pnpm build      # static site in apps/editor/dist
pnpm test       # unit tests
pnpm typecheck  # strict type checking
```

Drag “when program starts” from the toolbox onto the canvas, drop “print” into it, and press Run: the console shows `Hello, world!`.

## Documentation

- [Documentation index](docs/README.md)
- [Architecture](docs/zh/architecture.md)
- [Language & IR](docs/zh/ir.md)
- [Blocks](docs/zh/blocks.md)
- [Editor guide (Chinese)](docs/zh/editor.md)
- [i18n](docs/zh/i18n.md)
- [Roadmap](docs/zh/roadmap.md)

## Commit convention

Prefixes: `init:` `add:` `feat:` `docs:` `i18n:` `mod:` `fix:` `del:`. One logical change per commit.
