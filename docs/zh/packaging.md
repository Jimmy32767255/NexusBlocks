# 跨平台打包

Nexus Blocks 是 Tauri 桌面应用。两种安装包的性质不同：

| 目标 | 安装包 | 能否在另一系统上直接编译 |
| --- | --- | --- |
| Windows | NSIS `*-setup.exe` | Linux 上可以交叉编译（cargo-xwin + NSIS） |
| Linux | `.deb` | Windows 上不能原生编译，需要 WSL2 或 Docker |

MSI 安装包只能在 Windows 上构建（WiX 依赖 Windows 组件），本项目只产出 NSIS 安装器，因此 Windows 包可以在 Linux 上交叉编译。

## 一键打包

先安装依赖（见下文对应平台），然后：

```bash
pnpm package:linux     # 只打 Linux .deb
pnpm package:windows   # 只打 Windows NSIS setup.exe
pnpm package:all       # 两个都打
```

产物会复制到仓库根目录的 `dist/packages/`。脚本会先构建前端，再调用 `tauri build`，所以不需要手动执行 `pnpm build`。

- 在 Linux 上执行 `package:all`：本地构建 `.deb`，并用 `cargo-xwin` 交叉编译 Windows 安装器。
- 在 Windows 上执行 `package:all`：本地构建 Windows 安装器，再通过 WSL2 构建 `.deb`。
- 只想在 Windows 上打 Windows 包：`pnpm package:windows`，不需要 WSL。

## Linux 上构建两种包

### 系统依赖

Ubuntu / Debian：

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf \
  nsis llvm clang lld
```

Arch Linux：

```bash
sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg patchelf \
  nsis llvm clang lld
```

> 各发行版的 NSIS 包必须带 `Stubs/` 和 `Plugins/`（Ubuntu 的 `nsis` 包满足）。如果只有 `makensis` 而没有插件，Windows 安装器会在编译脚本阶段失败。

### Rust 交叉工具链

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
```

`cargo-xwin` 第一次构建时会下载 Windows SDK，缓存到 `~/.cache/cargo-xwin`（可用 `XWIN_CACHE_DIR` 改位置）。

### 执行

```bash
pnpm install
pnpm package:linux
pnpm package:windows   # 交叉编译 NSIS 安装器
```

Windows 产物位于：

```text
apps/desktop/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe
```

Linux 产物位于：

```text
apps/desktop/src-tauri/target/release/bundle/deb/*.deb
```

`pnpm package:all` 会把它们汇总到 `dist/packages/`。

## Windows 上构建 Linux 包

Tauri 的 Linux 打包器依赖 WebKitGTK / GTK / AppImage 工具，这些在 Windows 原生环境不可用，因此走 WSL2：

1. 在 Windows 上安装 WSL2 和一个 Ubuntu 发行版。
2. 在 WSL 里安装上一节的系统依赖、Node.js（22+）、pnpm 和 Rust。
3. 在 WSL 里进入同一个仓库（`/mnt/c/...` 路径可用，但放在 WSL 文件系统里构建更快）。
4. 执行：

```bash
pnpm package:linux
```

也可以从 Windows 的 PowerShell 一键触发：

```powershell
pnpm package:all
```

脚本会检测 `wsl`，通过 `wslpath` 转换仓库路径，再调用 `node scripts/package.mjs linux`。如果 WSL 未安装或里面缺少 pnpm，会打印需要执行的安装命令并退出。

## 关于“反向”交叉编译的边界

- Windows 上直接构建 `.deb` 不可行，WSL2 不是可选项而是必需条件。
- Linux 上构建 NSIS 安装器走的是 Tauri 官方支持路径，但仍比 Windows 原生构建更容易遇到工具链差异；发布前应在真实 Windows 上安装验证。
- 未做代码签名：Windows SmartScreen 会提示未知发布者，Linux 的 `.deb` 也没有签名。签名配置见 Tauri 的 Windows/macOS 签名文档，后续需要时再补。
- WebView2：默认安装器使用在线 bootstrapper，首次安装需要联网；如果要离线安装，需要在 `tauri.conf.json` 的 `bundle.windows.webviewInstallMode` 改为 `offlineInstaller`。

## 参考

- <https://v2.tauri.app/distribute/windows-installer/#build-windows-apps-on-linux-and-macos>
- <https://v2.tauri.app/distribute/debian/>

## 常见问题

### 构建 Windows 包时卡在下载 `nsis_tauri_utils.dll`

Tauri 打包 NSIS 时需要从 GitHub 下载这个辅助 DLL。网络受限时先设置代理再执行：

```bash
HTTPS_PROXY=http://127.0.0.1:1080 pnpm package:windows
```

代理只影响构建命令；安装包本身不依赖网络。

### `makensis` 报 `Usage: File ...` 或找不到 `English.nsh`

说明用的不是发行版自带的 NSIS。Ubuntu/Debian 装 `nsis` 包即可；如果只能用手便携版 NSIS，必须确保 `makensis` 在 `PATH` 中，且在 wine 下运行时脚本里的路径是 Windows 形式（`Z:\...`），否则 NSIS 会把 `/home/...` 当成命令行选项、`File` 找不到源文件。

### Windows 上打 Linux `.deb`

Tauri 的 Linux 打包依赖 Linux 工具链，Windows 主机的原生 shell 里没有 `dpkg-deb`。`pnpm package:all` 会自动尝试 WSL2；没有 WSL2 时请只打 Windows 包：

```bash
pnpm package:windows
```
