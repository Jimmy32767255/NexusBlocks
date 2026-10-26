# 文档

Nexus Blocks 的文档目前以简体中文为主，英文版 README 覆盖项目概览与快速开始。

## 中文文档

- [架构总览](zh/architecture.md) — 数据流、模块边界、能力模型
- [语言与 IR](zh/ir.md) — 文档格式、值类型、序列化、校验
- [`.nblk` 文本格式](zh/nblk.md) — 类 Python 的程序文件语法
- [积木系统](zh/blocks.md) — 定义 schema、内置积木、如何新增积木
- [编辑器使用指南](zh/editor.md) — 界面、拖拽规则、快捷键
- [命令行解释器](zh/cli.md) — `nblk` 的用法、参数与错误输出
- [国际化](zh/i18n.md) — 语言包、message key、新增语言
- [桌面外壳](zh/desktop.md) — Tauri 2、直接文件系统访问、能力桥、打包
- [跨平台打包](zh/packaging.md) — Linux `.deb` 与 Windows 安装包
- [设计决策记录](zh/decisions.md) — 下标口径、运行限制、兼容策略
- [路线图](zh/roadmap.md) — v0.1 到 v1.0 的计划

## English

- [README (English)](../README.en.md) — overview, quick start, layout

## 反馈与贡献

- 提交信息使用前缀：`init:` `add:` `feat:` `docs:` `i18n:` `mod:` `fix:` `del:`
- 改积木 definition 时同步补 `packages/i18n` 的中英文 key（测试会检查对齐）
- 新增语言包见 [国际化](zh/i18n.md)
