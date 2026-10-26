# 命令行解释器 `nblk`

`nblk` 是不依赖图形界面的独立解释器：它读取 `.nblk` 文件，解析成 IR 后直接执行，可以像 Python 一样在终端里运行程序。图形编辑器在**无断点、非跟踪的普通运行**时也会调用它；有断点、单步或跟踪运行仍使用编辑器内置引擎。

## 构建与安装

```bash
pnpm cli:build     # 用 esbuild 打包出 Node 可执行的 packages/cli/dist/nblk.cjs
pnpm cli:package   # 生成单文件可执行程序 packages/cli/dist/nblk（需要 Bun）
pnpm cli:install   # 复制到 ~/.local/bin（或 $XDG_BIN_HOME；需要 Bun）
```

`pnpm cli:package:windows` 会在 Linux 上下载 Bun 的 Windows 版本并交叉编译出 `nblk.exe`；也可以在 Windows 上直接执行 `pnpm cli:install`（同样需要 Bun）。

如果 `~/.local/bin` 不在 `PATH` 中，请自行加入，或把 `packages/cli/dist/nblk` 软链到已在 `PATH` 的目录。

## 用法

```bash
nblk hello.nblk                 # 运行
nblk --lang en hello.nblk       # 英文错误信息
nblk --check hello.nblk         # 只做语法解析，不执行（也不做语义校验）
nblk --json hello.nblk          # 运行阶段每行输出一个 JSON 事件
nblk - < hello.nblk             # 从标准输入读取源码
nblk --version
```

退出码：`0` 正常结束（含 `--check` 通过）；`1` 运行时错误（含运行前校验失败）；`2` 用法错误、文件不存在或不可读、语法解析失败；Ctrl+C 中断返回 `130`。

`--json` 只影响运行阶段的事件流，每行一个 `status`、`log` 或 `error`；解析失败、读文件错误和 `--check` 的输出仍是纯文本。图形编辑器正是通过这个流把 CLI 的输出显示到控制台。

## 相对导入的基准目录

`nblk a/b/main.nblk` 里的相对导入路径以 `a/b/` 为基准；从标准输入读取时以当前工作目录为基准。绝对路径按字面解析，`~/…` 会展开为用户主目录。

## 与图形编辑器的关系

- 桌面版编辑器启动时查找 `nblk`：先看环境变量 `NEXUS_NBLK`，再看应用同目录，最后查 `PATH`。
- 找到时，无断点、非跟踪的普通运行（工具栏「运行」按钮）把当前程序打印成 `.nblk` 文本，通过标准输入交给 CLI 执行，并把日志/状态流回编辑器；找不到时自动回退到内置引擎。有断点时也回退到内置引擎。
- 调试（断点、单步、跟踪运行）始终在编辑器内执行，因为需要语句级暂停。
- 桌面安装包不内嵌 CLI：需要单独安装 `nblk`，或设置 `NEXUS_NBLK=/path/to/nblk`。

## 已知边界

- CLI 执行时不带编辑器的调试元数据；调试信息本来就不写入 `.nblk`。
- 浏览器版编辑器没有 CLI，运行始终走内置引擎。
- 通过标准输入运行时，程序没有“文件位置”，相对导入以进程工作目录为准。
