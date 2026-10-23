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

- 完整图形编辑器：工具箱（分类可折叠）、拖拽/吸附、嵌套积木、画布平移缩放、属性面板（脚本可上下移）、变量面板、控制台、问题面板、撤销重做、本地自动保存。
- 48 种基础积木：控制/输出/注释/逻辑/数学/文本/变量之外，还有等待、跳出循环、错误处理（抛出/尝试/捕获）、列表与字典、函数定义与参数、本机文件读写；每个函数定义还会动态生成一个调用块。
- **跨文件导入**：`导入[文件]`、`从[文件]导入[函数]`、`从[文件]导入[函数]作为[名称]` 三种顶栏积木，从其他 `.nexusblocks.json` 文件载入函数并生成调用块；被导入文件的函数与变量会合并进当前程序。
- 解释器：步数上限、可中止、事件流（日志/输出/状态/错误）、变量作用域。
- 中英文界面与消息，运行输出也按项目语言显示。
- **桌面外壳（Tauri 2）**：加载同一份编辑器 bundle，`fs.*` 直接访问本机文件系统（绝对路径、`~/…` 或主目录相对路径）；浏览器版仍保留 localStorage 文件区。
- `pnpm test` 覆盖 IR、i18n、engine 与编辑器核心逻辑（127 个用例）。

尚未实现（已为它们预留接口）：网络/进程/剪贴板等更多系统能力、列表/字典的遍历与删除等进阶操作、代码导出、多平台安装包流水线。

## 目录结构

```
packages/ir      语言 IR：数据模型、JSON 序列化、校验、遍历、示例
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
pnpm desktop:build  # 构建桌面安装包（deb）
```

桌面版需要 Rust 1.77+；Linux 另需 `webkit2gtk-4.1`、`gtk+-3.0`、`libsoup-3.0` 开发包，Debian/Ubuntu 上为 `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`。

`pnpm desktop` 通过 `scripts/desktop-display.mjs` 启动，会自动找回丢失的 `WAYLAND_DISPLAY` / `DISPLAY`（ssh、非图形会话里常见），没有可用的显示器时退回 `xvfb-run`；细节见[桌面外壳](docs/zh/desktop.md)。

打开编辑器后，从左侧工具箱把「当程序启动时」拖到画布，再拖入「打印」，点顶部「运行」即可在控制台看到 `Hello, world!`。

## 文档

- [文档索引](docs/README.md)
- [架构总览](docs/zh/architecture.md)
- [语言与 IR](docs/zh/ir.md)
- [积木系统](docs/zh/blocks.md)
- [编辑器使用指南](docs/zh/editor.md)
- [国际化](docs/zh/i18n.md)
- [桌面外壳](docs/zh/desktop.md)
- [路线图](docs/zh/roadmap.md)

## 提交约定

提交信息使用前缀：`init:` `add:` `feat:` `docs:` `i18n:` `mod:` `fix:` `del:`，一次提交只做一件事。
