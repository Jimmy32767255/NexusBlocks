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
- 性能：单层解释约 2.8M 步/秒；固定点（nblk1 解释自己、再解释 demo）经 CLI 约数秒。
  引擎每 1024 步才让出一次事件循环（`setImmediate`/`MessageChannel`，不是被钳制到 1ms 的
  `setTimeout`），并按节点缓存块定义、按静态块类型缓存端口元数据，函数体的标签索引也只建一次
  （`返回` 用非 `Error` 的信号，避免每次返回都抓栈）；nblk1 则把 `端口`/字段读取内联、按热度重排分派。
- 三层嵌套 `nblk1(nblk1(nblk1(demo)))` 也能跑出正确结果，约 2.53 亿步、2 分 4 秒，
  只作压力测试，不进 CI。

## nblk2 —— 源码前端（自举的第二块拼图）

`bootstrap/nblk1.nblk` 只吃 IR JSON。`bootstrap/nblk2.nblk` 把 `.nblk` 源码
（词法、表达式、语句、函数定义、`导入`）编译成同一套项目 IR，再调用 nblk1 的
`装载` / `执行项目` 运行——于是 `.nblk` 源码可以由 `.nblk` 写的前端解释。

```bash
# 直接用源码前端运行一个程序
node packages/cli/src/bin.ts bootstrap/nblk2.nblk -- bootstrap/examples/demo.nblk

# 源码级自举：nblk2 编译 nblk1.nblk，再由它执行 demo 的 IR
node packages/cli/src/bin.ts bootstrap/nblk2.nblk -- \
  bootstrap/nblk1.nblk bootstrap/examples/demo.ir.json
```

`node tools/bootstrap-check.mjs --self` 会同时比对：原生 vs nblk1、原生 vs nblk2、
nblk1 解释自己、nblk1 解释 nblk2（source-under-IR）、以及 nblk2 编译 nblk1。

实现要点：

- 行预处理保留缩进（`缩`/`文`），`#` 注释剥离、字符串内的 `\"` 与 `#` 不误判。
- 词法手写：数字/字符串/标识符/符号四类，符号串 `()[]{},.:+-*/%<>=!`。
- 递归下降：或→与→比较→加→乘→一元→后缀→原子；`并且`/`或者` 中缀。
- 常量（数字、文本、真假、空）直接写进端口 `fields`，与原生 IR 的“内联字面量”一致。
- 节点 id 由 `nblk2_新号()` 生成（`b_1`、`b_2`…），函数调用直接写成 `func.call:<id>`。
- `导入` 会递归读取同目录文件、合并其定义与脚本（跳过被导入文件的 `开始:`）。

已知限制：

- `导入` 相对主文件目录解析，暂不支持子目录内的相对路径。
- 文本里的 `跳过` 与原生一致，是空语句（`control.pass`），不是 `continue`。
- `nblk2` 的源码级自解释：nblk2（原生）编译 nblk2.nblk 约 1 分钟完成解析；让 **nblk1** 去解释
  nblk2 再编译 nblk2.nblk 仍需数分钟（纯性能问题，非语义问题）。`nblk1` 解释 nblk2 编译
  `bootstrap/tests/data.nblk` 已与原生一致（`--self` 中的 source-under-IR 项）。
- `tools/ir-dump.mjs` 默认用真实文件系统解析 `导入`，导出自包含的项目 IR；`--no-imports` 只导出单个文件。
- 参数传递：`nblk1` 提供 `执行项目带参数(项目, 参数列表)`，把参数显式传给被解释程序；
  `nblk2` 用它把 `参数()` 的剩余部分交给目标程序。
