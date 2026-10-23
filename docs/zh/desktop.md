# 桌面外壳（Tauri 2）

浏览器版把工作区文件放在 `localStorage` 里，刷新不丢，但它不是真实文件系统。桌面外壳解决这一层：同一个编辑器 bundle 运行在 Tauri 的 WebView 中，文件能力由 Rust 进程落到用户选定的目录。

```
┌─────────────────────────────┐
│ 编辑器 bundle（apps/editor）│
│   HostBridge → capability   │
└──────────────┬──────────────┘
               │ invoke("capability_invoke")
┌──────────────▼──────────────┐
│ Rust 主进程（src-tauri）    │
│  工作区根目录 + 路径校验    │
│  fs.read / write / ...      │
└─────────────────────────────┘
```

## 运行

需要：

- Rust 1.77+（`rustup` 安装即可）
- Linux 还需 `webkit2gtk-4.1`、`libsoup-3.0`、`gtk+-3.0` 开发包
  （Debian/Ubuntu：`libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev`）

```bash
pnpm install
pnpm desktop          # 开发模式：Vite + Tauri 窗口
pnpm desktop:build    # 构建安装包（默认 deb）
```

`pnpm desktop` 会先启动编辑器的 Vite 开发服务器，再打开原生窗口；编辑器代码改动仍然热更新。

## 工作区与文件

- 首次启动使用应用数据目录下的 `workspace/`（Linux 约为 `~/.local/share/dev.nexus.blocks/workspace`）。
- 顶栏「工作区文件夹」按钮调用系统目录选择框，选择后立即生效并写入配置，下次启动沿用。
- 积木里的路径一律是**工作区内的相对路径**，用 `/` 分隔。`fs.*` 只在这个根目录内解析：
  - 拒绝 `..`、绝对路径、空段、控制字符；
  - 已存在的路径会做 canonicalize 检查，符号链接指到工作区外同样会被拒绝；
  - 读取/写入上限 100 万字符，写入先写临时文件再 `rename`，避免留下半截文件。
- 路径、大小等错误以 message key 返回（`runtime.error.filePath` 等），控制台显示为当前语言的提示。

## 能力与安全模型

语言层看不到文件系统，只发能力请求：

| 能力 | 风险 | 说明 |
| --- | --- | --- |
| `console.print` | none | 由编辑器本地处理，不进 Rust |
| `fs.read` / `fs.write` | medium | 读写工作区文本文件 |
| `fs.exists` / `fs.list` / `fs.delete` | low / low / medium | 查询、列目录、删除 |

桌面宿主在 `apps/editor/src/desktop.ts` 中实现：检测到 `__TAURI_INTERNALS__` 时替换掉浏览器宿主，其余代码不变。Rust 侧的命令是：

- `capability_invoke(request)` — 统一入口，返回 `{ ok, value }` 或 `{ ok: false, error: { messageKey } }`
- `workspace_get` / `workspace_choose` — 读取与切换工作区

后续要把能力扩展到进程、网络时，仍然是「新增能力 + 在 Rust 侧加一条路由」，编辑器与积木无需感知具体实现。

## 打包

`pnpm desktop:build` 使用 Tauri 默认 bundler，`src-tauri/tauri.conf.json` 里 `bundle.targets` 目前只配置了 `deb`；需要 AppImage/rpm 时加进数组即可。前端产物来自 `apps/editor/dist`，由 `beforeBuildCommand` 自动重新构建。

图标由 `tauri icon` 从 `src-tauri/icons/source.png` 生成，已提交到仓库。
