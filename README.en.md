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
- 32 built-in blocks across control/IO/logic/math/text/variables, plus waiting, breaking out of loops, lists and dictionaries, function definitions/parameters, and workspace file I/O. Every function definition also yields a dynamic call block.
- An interpreter with a step limit, cancellation, event stream (logs, output, status, errors), and variable scopes.
- English and Chinese UI, runtime messages, and program output in the project locale.
- **Desktop shell (Tauri 2)**: loads the same editor bundle; `fs.*` maps to a user-chosen workspace folder with real files, while the browser build keeps its localStorage workspace.
- `pnpm test` covers IR, i18n, engine, and editor logic (72 cases).

Not built yet (interfaces reserved): network/process/clipboard capabilities, advanced list/dict operations such as iteration and removal, code export, and multi-platform packaging pipelines.

## Layout

```
packages/ir      Language IR: data model, JSON serialisation, validation, traversal, samples
packages/engine  Block definitions & registry, interpreter, capability requests, runtime events
packages/i18n    Message catalogues and translator
apps/editor      Web editor (Vite + vanilla TypeScript)
apps/desktop     Tauri 2 desktop shell (Rust host, Tauri config)
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
pnpm desktop        # desktop dev window (needs Rust + webkit2gtk-4.1)
pnpm desktop:build  # build a desktop installer (deb)
```

The desktop build needs Rust 1.77+; on Linux also the `webkit2gtk-4.1`, `gtk+-3.0` and `libsoup-3.0` development packages. Work on Windows/macOS only needs the Rust toolchain.

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
