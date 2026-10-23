# Nexus Blocks

English | [简体中文](README.md)

Nexus Blocks is an **extensible visual programming environment**: you build programs out of blocks, but underneath sits a complete modern language instead of a toy that can only animate sprites.

## Goals

- **Full language power** — variables, functions, collections, control flow, first-class values. Every block maps onto the language IR.
- **Extensible** — blocks, host capabilities, renderers, and language packs are all pluggable.
- **Ready for system interaction** — the runtime calls the host through *capabilities*. The desktop shell (Tauri + Rust) can safely expose files, processes, and networking later. v0.1 ships none of those, but the architecture already reserves the place for them.
- **Internationalized** — UI, block labels, runtime output, and documentation are all translatable. Chinese and English ship first.
- **WebView first** — the editor is a plain web app; the desktop shell is the system WebView (Tauri).

## Status

v0.1 is being built: graphical editor, core blocks, runtime, English/Chinese translations, and documentation.

## Repository layout

```
packages/ir          Language intermediate representation: model, serialization, validation
packages/blocks      Block definitions and registry (UI agnostic)
packages/runtime     Interpreter, capability host, execution event stream
packages/i18n        Language packs and translation helpers
apps/editor          Web editor (Vite + vanilla TS + SVG)
apps/desktop         Tauri 2 desktop shell
docs                 Architecture, IR, block, and i18n documentation
```

## Quick start

```bash
pnpm install
pnpm dev            # open the editor at http://localhost:5173
pnpm test           # run unit tests
pnpm typecheck      # type checking
```

The desktop shell requires a Rust toolchain and WebKitGTK:

```bash
pnpm desktop         # run the Tauri window in dev mode
pnpm desktop:build   # build the desktop binary
```

## Design documents

- [Architecture overview](docs/en/architecture.md)
- [Language and IR](docs/en/ir.md)
- [Block system](docs/en/blocks.md)
- [Internationalization](docs/en/i18n.md)
- [Roadmap](docs/en/roadmap.md)
