# Nexus Blocks

[English](README.en.md) | 简体中文

Nexus Blocks 是一个**可扩展的图形化编程环境**：用积木搭程序，但底层是一门完整的现代语言，而不是只能做动画的玩具。

## 目标

- **完整的语言能力**：变量、控制流、表达式、值语义；每块积木都对应语言 IR 中的一个节点，图形与文本是同一套语义的两种视图。
- **可扩展**：积木定义、能力（capability）、渲染器、语言包彼此独立，新增积木不需要改编辑器核心。
- **能走向系统交互**：运行时只通过 `HostBridge` 调用宿主能力（文件、进程、网络……）。桌面端可以按能力清单授权；第一版只实现了 `console.print`，但方向与接口已经就位。
- **国际化**：界面、积木标签、运行时消息、文档都走同一套 key，默认简体中文与英文。
- **WebView 优先**：编辑器是纯静态 Web 应用（原生 TypeScript + Vite），可以嵌进任何 WebView（Tauri、Electron、移动端）。

## 当前状态（v0.1）

已经可用：

- 完整图形编辑器：工具箱（分类可折叠）、拖拽/吸附、嵌套积木、画布平移缩放、属性面板（脚本可上下移）、工具箱悬停提示与积木详情、变量面板（只读运行状态）、控制台、问题面板、撤销重做、本地自动保存。
- **调试**：暂停/继续、单步执行、语句断点、跟踪运行与实时变量值；调试状态只存编辑器，不写入 `.nblk`。
- 76 种基础积木：控制/输出/注释/逻辑/数学/文本/变量之外，还有等待、跳出循环、错误处理（抛出/尝试/捕获）、列表与字典、函数定义与参数、本机文件读写；文本按 Unicode 码点支持长度、取字符、子串、查找、拆分与码点互转；函数可用局部变量并支持递归，还有对每项循环、并且/或者、JSON 解析与命令行参数；每个函数定义还会动态生成一个调用块。
- **跨文件导入**：`导入[文件]`、`从[文件]导入[函数]`、`从[文件]导入[函数]作为[名称]` 三种顶栏积木，从其他 `.nblk` 文件载入函数并生成调用块；被导入文件的函数会合并进当前程序。
- 变量在运行时声明：用「创建变量」/「删除变量」积木建立和移除，没有预定义变量列表，因此 `.nblk` 里也无需声明区。
- 解释器：可中止、事件流（日志/输出/状态/错误）、全局变量表；不设步数或递归上限。
- 中英文界面与消息，运行输出也按项目语言显示。
- **桌面外壳（Tauri 2）**：加载同一份编辑器 bundle，`fs.*` 直接访问本机文件系统（绝对路径、`~/…` 或主目录相对路径）；浏览器版仍保留 localStorage 文件区。
- **`.nblk` 文本格式**：程序保存为类 Python 的可读文本（不是 JSON），关键字使用 UTF-8 中文，保留 IR 语义。语法见 [`docs/zh/nblk.md`](docs/zh/nblk.md)。
- **独立解释器**：`nblk program.nblk` 可在终端运行程序；桌面编辑器普通运行时调用它，调试仍用内置引擎。见 [`docs/zh/cli.md`](docs/zh/cli.md)。
- `pnpm test` 覆盖 IR、i18n、engine 与编辑器核心逻辑（195 个用例）。

## 自举（self-hosting）

语言现在能解释自己：

- [`bootstrap/nblk1.nblk`](bootstrap/nblk1.nblk) 是一个完全用 `.nblk` 写成的 IR 解释器：词法/语法由原生前端负责，求值、作用域、控制流、函数调用全部由 `.nblk` 代码实现。
- `pnpm bootstrap:check` 会把 `bootstrap/tests/*.nblk` 分别交给原生引擎和 nblk1 执行，逐行比对输出。
- `pnpm bootstrap:self` 让 nblk1 执行 nblk1 自己的 IR，用来验证自解释。

细节与限制见 [`bootstrap/README.md`](bootstrap/README.md)；路线图见 [`docs/zh/roadmap.md`](docs/zh/roadmap.md) 的 v0.7。

尚未实现（已为它们预留接口）：网络/进程/剪贴板等更多系统能力、列表/字典的遍历与删除等进阶操作、代码导出、多平台安装包流水线。

## 目录结构

```
packages/ir      语言 IR：数据模型、`.nblk` 解析/打印、校验、遍历、示例
packages/engine  积木定义与注册表、解释器、能力请求与运行时事件
packages/i18n    语言包与翻译函数
apps/editor      Web 编辑器（Vite + 原生 TypeScript）
apps/desktop     Tauri 2 桌面外壳（Rust 宿主、Tauri 配置）
docs/zh          架构、IR、积木、i18n、桌面壳、路线图
```

## 快速开始

需要 Node.js 22+ 与 pnpm 10+。

```bash
pnpm install
pnpm dev        # 编辑器 http://localhost:5173
pnpm build      # 产出 apps/editor/dist 静态站点
pnpm test       # 全部单元测试
pnpm typecheck  # 严格类型检查
pnpm desktop        # 桌面版开发模式（需要 Rust 与 webkit2gtk-4.1）
pnpm cli:build      # 构建命令行解释器（packages/cli/dist/nblk）
pnpm desktop:build  # 构建当前平台桌面安装包
pnpm package:all    # 打包 Linux .deb 与 Windows setup.exe（见打包文档）
```

桌面版需要 Rust 1.77+；Linux 另需 `webkit2gtk-4.1`、`gtk+-3.0`、`libsoup-3.0` 开发包，Debian/Ubuntu 上为 `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`。

`pnpm desktop` 通过 `scripts/desktop-display.mjs` 启动，会自动找回丢失的 `WAYLAND_DISPLAY` / `DISPLAY`（ssh、非图形会话里常见），没有可用的显示器时退回 `xvfb-run`；细节见[桌面外壳](docs/zh/desktop.md)。

打开编辑器后，从左侧工具箱把「当程序启动时」拖到画布，再拖入「打印」，点顶部「运行」即可在控制台看到 `Hello, world!`。

## 文档

- [跨平台打包](docs/zh/packaging.md)：在 Linux/Windows 上构建两种安装包
- [文档索引](docs/README.md)
- [设计决策记录](docs/zh/decisions.md)
- [架构总览](docs/zh/architecture.md)
- [语言与 IR](docs/zh/ir.md)
- [积木系统](docs/zh/blocks.md)
- [编辑器使用指南](docs/zh/editor.md)
- [国际化](docs/zh/i18n.md)
- [桌面外壳](docs/zh/desktop.md)
- [路线图](docs/zh/roadmap.md)

## 提交约定

提交信息使用前缀：`init:` `add:` `feat:` `docs:` `i18n:` `mod:` `fix:` `del:`，一次提交只做一件事。
