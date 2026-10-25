# 架构总览

Nexus Blocks 由三部分组成：**语言（IR + 引擎）**、**编辑器（Web 前端）**、**宿主（未来：Tauri 桌面壳）**。三者只通过文档（`NexusDocument`）、积木注册表与能力调用通信，因此可以独立演进。

## 数据流

```
用户拖拽 ──▶ Editor Store（唯一状态源）
                 │  document（NexusDocument：语言 + 布局）
                 ▼
        serializeDocument / printNblk → .nblk（保存 / 导出；自动保存仍用 JSON）
                 │
                 ▼
        parseDocument → validateProject（结构校验）
                 │
                 ▼
   Interpreter（按 hat 块执行，逐步产出事件）
                 │  RuntimeEvent: log / status / error
                 ├──────────────▶ 控制台面板
                 │
                 ▼
        HostBridge（能力调用，如 console.print）
```

- **IR 不知道像素**：`packages/ir` 只描述程序语义（`Project`）与编辑器布局（`EditorLayout`），不认识 DOM、画布、颜色。
- **引擎不知道 UI**：`packages/engine` 只认识 `BlockRegistry` 与 `HostBridge`，可以被 CLI、测试或未来的文本视图复用。
- **编辑器不知道执行细节**：它持有文档和注册表，把拖拽转换为 IR 修改，把运行事件渲染为日志。

## 为什么用 JSON IR 而不是直接执行积木树

1. **可持久化、可 diff、可迁移**：文档是纯 JSON，版本字段让未来升级格式时有据可依。
2. **一份语义，多种视图**：图形编辑器、命令行 runner、未来的文本代码视图都读写同一份 IR。
3. **能力边界清晰**：副作用只能通过 `HostBridge` 发生；不同宿主实现同一组能力（浏览器用 `localStorage`、桌面用真实文件系统、CLI 用 Node），也方便测试注入假宿主。

## 文档模型

`NexusDocument` = `project`（语言与语义）+ `editor`（画布位置、视口）。

脚本是**顶层 hat 块的数组**，hat 的栈端口（`inputs.body`）保存块体；嵌套块同样用 `inputs[port]` 表示。值端口可以放表达式块或内联字面量（`fields[port]`）。

## 编辑器状态

`EditorState` 包含 `document`、`selectedId`、`status`、`logs`、`dirty`、`zoom`。所有修改都经过 `Store.update`：

```ts
store.update((document) => {
  document.project.name = "Demo";
}); // 默认记录 undo 快照、标记 dirty
```

拖拽过程中会用 `{ history: false, dirty: false }` 临时改动，完成后再落一次历史。视图在 `subscribe` 回调里整树重渲染——v0.1 的文档规模下，这比虚拟 DOM 更简单、更可预测。

## 宿主与能力

运行时遇到需要副作用的行为时，发出 `HostRequest`：

```ts
interface HostBridge {
  readonly name: string;
  readonly capabilities: readonly CapabilityDescriptor[];
  invoke(request: HostRequest): Promise<HostResult>;
}
```

`HostRequest` 带 `capability`、`args` 和发起调用的 `blockId`，宿主可据此审计与追问授权。默认宿主实现 `console.print`；传入 `storage` 时还会启用 `fs.read` / `fs.write` / `fs.exists` / `fs.delete` / `fs.list`（浏览器里是 localStorage 工作区）。桌面壳已经实现真实的文件系统（不设工作区根目录，路径按绝对路径 / `~/…` / 主目录相对路径解析），后续 `net.fetch`、`proc.spawn` 等继续按能力逐项加入。

## 国际化

所有用户可见文本（包括运行时错误）都是 message key，由 `@nexus/i18n` 翻译：

- 编辑器：`t("canvas.emptyTitle")`，语言保存在 localStorage。
- 运行：`runProject` 产出 `messageKey` 与 `params`，编辑器负责翻译，因此程序输出跟随界面语言而不是写死英文。

## 后续演进

- **桌面壳**：Tauri 2 + Rust，窗体加载编辑器静态资源，Rust 侧实现 `HostBridge` 并通过 IPC 上报能力。
- **更多值类型**：列表、字典、记录、函数值；IR 的 `Value` 与 `ValueType` 已经可扩展。
- **性能**：文档规模变大后，渲染改为按脚本/按块增量更新；拖拽预览使用独立图层。

详见 [语言与 IR](ir.md)、[积木系统](blocks.md)、[国际化](i18n.md)、[路线图](roadmap.md)。
