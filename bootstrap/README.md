# nblk1 —— 用 .nblk 写的 Nexus Blocks 解释器

`bootstrap/nblk1.nblk` 是一个用 Nexus Blocks 自身实现的 **IR 解释器**：它读取
`tools/ir-dump.mjs` 导出的项目 IR（JSON），按与原生引擎相同的语义执行程序。

这是自举路线的第一级（L1）：语言不再只能解释“别的语言写的程序”，而是能解释
自己。

## 运行

```bash
# 1. 把 .nblk 编译成 IR
node tools/ir-dump.mjs bootstrap/examples/demo.nblk bootstrap/examples/demo.ir.json

# 2. 用 nblk1 执行 IR
node packages/cli/src/bin.ts bootstrap/nblk1.nblk bootstrap/examples/demo.ir.json

# 3. 对照原生执行
node packages/cli/src/bin.ts bootstrap/examples/demo.nblk
```

## 一致性测试

`bootstrap/tests/*.nblk` 是行为基准：原生引擎与 nblk1 的输出必须逐行相同。

```bash
for f in bootstrap/tests/*.nblk; do
  node packages/cli/src/bin.ts "$f" > .tmp-check/native.txt
  node tools/ir-dump.mjs "$f" .tmp-check/prog.ir.json
  node packages/cli/src/bin.ts bootstrap/nblk1.nblk .tmp-check/prog.ir.json > .tmp-check/nblk1.txt
  diff .tmp-check/native.txt .tmp-check/nblk1.txt || echo "MISMATCH: $f"
done
```

## 固定点：nblk1 解释自己

nblk1 的 IR 也是普通项目 IR，因此可以让 nblk1 解释 nblk1，再让「被解释的
nblk1」去解释 demo：

```bash
node tools/ir-dump.mjs bootstrap/nblk1.nblk bootstrap/nblk1.ir.json
node packages/cli/src/bin.ts bootstrap/nblk1.nblk bootstrap/nblk1.ir.json bootstrap/examples/demo.ir.json
```

输出与直接解释 demo 相同（`10` / `大`）。`node tools/bootstrap-check.mjs --self`
会自动比对这一步，并跑 `bootstrap/tests` 的全部一致性用例。

参数约定：nblk1 把第 1 个程序参数当作要执行的 IR，其余参数作为被解释程序的
`参数()`；`sys.args` 在内层返回这些剩余参数。

## 实现要点

- 环境：单一条 `环境` 帧列表（`环境[0]` 是全局帧）；`读变量/写变量/建全局/建局部`
  沿链查找，调用函数时压帧、返回时弹出。
- 变量命名空间：自举时被解释程序的变量与解释器自身的参数/局部变量共用同一条
  环境链，同名就会互相覆盖。因此 nblk1 的标识符统一带 `nblk1_` 前缀，并按函数
  再分段：`nblk1_<函数名>_<变量>`，全局变量为 `nblk1_g_<变量>`。`nblk1_` 是
  保留前缀，普通程序不要使用。
- 控制流：`返回/跳出循环` 用 `{"kind": "return"|"break", ...}` 信号字典表示，
  `执行块` 逐句传播，`执行语句` 在循环与函数边界捕获。
- 值与类型：直接使用语言自带的列表/字典，`类型()` 区分六种值类型。
- 函数：按 `func.call:<id>` 查函数表，实参按 `参数表` 取端口。

## 已知限制

- 不执行 `导入`（IR 里的 import 块被忽略）；导入由原生前端在导出 IR 前解析。
- 不支持 `执行命令`（`os.exec_command`），按错误处理。
- 性能：单层解释约 1M 步/秒；固定点（nblk1 解释自己、再解释 demo）经 CLI 约数秒。
- 三层嵌套 `nblk1(nblk1(nblk1(demo)))` 也能跑出正确结果，但需要 1.33 亿步、约 2 分 20 秒，
  只作压力测试，不进 CI。
