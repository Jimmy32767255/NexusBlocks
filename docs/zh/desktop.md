# 桌面外壳（Tauri 2）

浏览器版把文件放在 `localStorage` 里，刷新不丢，但它不是真实文件系统。桌面外壳解决这一层：同一个编辑器 bundle 运行在 Tauri 的 WebView 中，文件能力由 Rust 进程直接落到本机磁盘。

```
┌─────────────────────────────┐
│ 编辑器 bundle（apps/editor）│
│   HostBridge → capability   │
└──────────────┬──────────────┘
               │ invoke("capability_invoke")
┌──────────────▼──────────────┐
│ Rust 主进程（src-tauri）    │
│  绝对路径 / ~ / 主目录相对  │
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

### 打不开窗口：`Failed to initialize GTK`

Linux 上 Tauri 通过 GTK 建窗口，`DISPLAY` 和 `WAYLAND_DISPLAY` 都不可用时就会直接 panic：

```
Failed to initialize gtk backend!: BoolError { message: "Failed to initialize GTK" }
```

常见于 ssh 登录、从非图形会话启动的 tmux、或者 `scripts/dev-env.sh` 把 `XDG_RUNTIME_DIR` 指向仓库目录之后。`pnpm desktop` 现在经由 `scripts/desktop-display.mjs` 启动，会按顺序尝试：

1. 沿用有效的 `WAYLAND_DISPLAY` / `DISPLAY`；
2. 在 `$XDG_RUNTIME_DIR`、`/run/user/$UID` 里找一个活着的 `wayland-<n>` 或 `X<n>` socket，并顺手补上 `DBUS_SESSION_BUS_ADDRESS`；
3. 都没有时退回 `xvfb-run` 虚拟显示（窗口不可见，仅用于跑通/截图）。

屏幕上的窗口只会出现在这些 socket 所属的那台机器、那个会话上；从别的电脑 ssh 过来时需要 `ssh -X` 做 X11 转发。

## 保存与打开项目

浏览器版用 `<a download>` 触发下载；**WebKitGTK（Tauri 在 Linux 上的 WebView）会忽略 `download` 属性，也不允许网页弹出系统文件选择器**，所以桌面版必须走原生对话框：

| 动作 | 桌面版 | 浏览器版 |
| --- | --- | --- |
| 保存 | `project_save` 打开系统「另存为」，把 JSON 写到你选的位置 | 下载到浏览器默认目录 |
| 打开 | `project_open` 打开系统文件选择器，读回文本后按同一套校验解析 | `<input type="file">` |

- 取消对话框不会提示“已保存”，文档也不会被标记为已保存；
- 项目文件名取自项目名（`/ \ : * ? " < > |` 换成 `-`），后缀固定 `.nexusblocks.json`；
- 写入前会自动创建目标目录，失败按 `runtime.error.file*` 报错并弹提示；
- 桌面与浏览器共用 `persist.ts` 的解析/序列化，文件格式完全一致，可以互相拷。

## 文件路径

桌面版**不设工作区根目录**，积木里的路径按下面的规则解析：

| 写法 | 解析结果 |
| --- | --- |
| `/home/me/notes.txt`、`C:\notes.txt` | 绝对路径，原样使用 |
| `~/notes.txt` | 相对用户主目录 |
| `notes.txt`、`projects/demo.txt` | 相对用户主目录 |
| 空路径 | `file.list` 列主目录；其余积木报 `runtime.error.filePath` |

其他约束：

- 单个文件读取/写入上限 100 万字符；
- 写入会先创建父目录，然后写临时文件再 `rename`，失败不会留下半截文件；
- 路径为空、包含控制字符或超过 1024 字符时报 `runtime.error.filePath`；
- 文件不存在、无权限分别映射为 `runtime.error.fileNotFound` / `runtime.error.fileDenied`，控制台按当前语言显示。

浏览器版仍然只能访问 `localStorage` 里的扁平文件，不支持目录与绝对路径；桌面版没有这个限制。

## 能力与安全模型

语言层看不到文件系统，只发能力请求：

| 能力 | 风险 | 说明 |
| --- | --- | --- |
| `console.print` | none | 由编辑器本地处理，不进 Rust |
| `fs.read` / `fs.write` | medium | 读写文本文件 |
| `fs.exists` / `fs.list` / `fs.delete` | low / low / medium | 查询、列目录、删除 |

桌面宿主在 `apps/editor/src/desktop.ts` 中实现：检测到 `__TAURI_INTERNALS__` 时替换掉浏览器宿主，其余代码不变。Rust 侧只有一个统一命令：

- `capability_invoke(request)` — 返回 `{ ok, value }` 或 `{ ok: false, error: { messageKey } }`

> ⚠️ 安全边界：桌面版当前对 `fs.*` **默认全部授权**，程序可以读写当前用户有权访问的任意文件。后续计划加入按项目的能力授权面板与审计日志；在装上之前，只运行你信任的项目。

后续要把能力扩展到进程、网络时，仍然是「新增能力 + 在 Rust 侧加一条路由」，编辑器与积木无需感知具体实现。

## 打包

`pnpm desktop:build` 使用 Tauri 默认 bundler，`src-tauri/tauri.conf.json` 里 `bundle.targets` 目前只配置了 `deb`；需要 AppImage/rpm 时加进数组即可。前端产物来自 `apps/editor/dist`，由 `beforeBuildCommand` 自动重新构建。

图标由 `tauri icon` 从 `src-tauri/icons/source.png` 生成，已提交到仓库。
