# 命令行解释器 `nblk`

`nblk` 是不依赖图形界面的独立解释器：它读取 `.nblk` 文件，解析成 IR 后直接执行，可以像 Python 一样在终端里运行程序。图形编辑器在**普通运行**时也会调用它（断点、单步、跟踪仍使用编辑器内置引擎）。

## 构建与安装

```bash
pnpm cli:package   # 生成单文件可执行程序 packages/cli/dist/nblk
pnpm cli:install   # 复制到 ~/.local/bin（或 $XDG_BIN_HOME）
```

`pnpm cli:package:windows` 会在 Linux 上下载 Bun 的 Windows 版本并交叉编译出 `nblk.exe`；也可以在 Windows 上直接执行 `pnpm cli:install`。

如果 `~/.local/bin` 不在 `PATH` 中，请自行加入，或把 `packages/cli/dist/nblk` 软链到已在 `PATH` 的目录。

## 用法

```bash
nblk hello.nblk                 # 运行
nblk --lang en hello.nblk       # 英文错误信息
nblk --check hello.nblk         # 只解析 + 校验，不执行
nblk --json hello.nblk          # 机器可读事件（每行一个 JSON）
nblk - < hello.nblk             # 从标准输入读取源码
nblk --version
```

退出码：`0` 正常结束；`1` 解析/校验/运行错误；`2` 命令行用法错误。

`--json` 每行输出一个事件：`status`、`log`、`error`；图形编辑器正是通过这个流把 CLI 的输出显示到控制台。

## 相对导入的基准目录

`nblk a/b/main.nblk` 里的相对导入路径以 `a/b/` 为基准；从标准输入读取时以当前工作目录为基准。绝对路径和 `~/…` 始终按字面解析。

## 与图形编辑器的关系

- 桌面版编辑器启动时查找 `nblk`：先看环境变量 `NEXUS_NBLK`，再看应用同目录，最后查 `PATH`。
- 找到时，普通运行（F5/运行按钮）把当前程序打印成 `.nblk` 文本，通过标准输入交给 CLI 执行，并把日志/状态流回编辑器；找不到时自动回退到内置引擎。
- 调试（断点、单步、跟踪运行）始终在编辑器内执行，因为需要语句级暂停。
- 桌面安装包不内嵌 CLI：需要单独安装 `nblk`，或设置 `NEXUS_NBLK=/path/to/nblk`。

## 已知边界

- CLI 执行时不带编辑器的调试元数据；调试信息本来就不写入 `.nblk`。
- 浏览器版编辑器没有 CLI，运行始终走内置引擎。
- 通过标准输入运行时，程序没有“文件位置”，相对导入以进程工作目录为准。
