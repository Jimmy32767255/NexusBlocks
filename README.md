# Nexus Blocks

[English](README.en.md) | 简体中文

Nexus Blocks 是一个**可扩展的图形化编程环境**：用积木搭建程序，但底层是一门完整的现代语言，而不是只能做动画的玩具。

## 目标

- **完整的语言能力**：变量、函数、集合、控制流、一等公民的值语义；块与语言 IR 一一对应。
- **可扩展**：块、宿主能力（capability）、渲染器、语言包都可以插拔。
- **可走向系统交互**：运行时通过「能力（capability）」调用宿主，桌面端（Tauri + Rust）可以安全地开放文件、进程、网络等能力。第一版不实现这些能力，但架构现在就为它们留好位置。
- **国际化**：UI、块标签、运行时输出、文档都支持多语言，默认简体中文与英文。
- **WebView 优先**：编辑器是一个纯 Web 应用，桌面壳使用系统 WebView（Tauri）。

## 当前状态

第一版（v0.1）正在搭建：图形编辑器、基础积木、运行时、中英文翻译与文档。

## 目录结构

```
packages/ir          语言中间表示（IR）：数据模型、序列化、校验
packages/blocks      积木定义与注册表（与 UI 无关）
packages/runtime     解释器、能力宿主、执行事件流
packages/i18n        语言包与翻译函数
apps/editor          Web 编辑器（Vite + 原生 TS + SVG）
apps/desktop         Tauri 2 桌面壳
docs                 架构、IR、积木、i18n 文档
```

## 快速开始

```bash
pnpm install
pnpm dev            # 启动编辑器 http://localhost:5173
pnpm test           # 运行单元测试
pnpm typecheck      # 类型检查
```

桌面端需要 Rust 工具链与 WebKitGTK：

```bash
pnpm desktop         # 开发模式启动 Tauri 窗口
pnpm desktop:build   # 构建桌面二进制
```

## 设计文档

- [架构总览](docs/zh/architecture.md)
- [语言与 IR](docs/zh/ir.md)
- [积木系统](docs/zh/blocks.md)
- [国际化](docs/zh/i18n.md)
- [路线图](docs/zh/roadmap.md)
