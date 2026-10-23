# 积木系统

积木由 `@nexus/engine` 注册表统一管理。一块积木 = 一份声明式 schema（给校验器与编辑器用）+ 一个执行函数（给解释器用）。

## 定义

```ts
interface BlockDefinition extends BlockSchema {
  color: string;
  execute?(ctx: ExecutionContext, node: BlockNode): void | Promise<void>;
  evaluate?(ctx: ExecutionContext, node: BlockNode): Value | Promise<Value>;
}
```

- `kind`：`hat`（入口）、`statement`（语句）、`expression`（表达式）。
- `output`：表达式的结果类型；语句与 hat 为 `void`。
- `fields`：属性编辑器（文本、数字、下拉、布尔、变量下拉）。
- `ports`：`stack`（可嵌套语句串）或 `value`（可插表达式块）。
- `label` / `description`：message key，由编辑器翻译。
- `execute` 处理语句/ hat，`evaluate` 返回表达式值；两者都可以是 async。

## 内置积木

| 类型 | 类别 | 说明 | 插槽 / 属性 |
| --- | --- | --- | --- |
| `control.start` | 控制 | 程序入口（hat） | `body` 栈 |
| `control.if` | 控制 | 条件分支 | `condition` 布尔值，`then`、`else` 栈 |
| `control.repeat` | 控制 | 重复执行 | `times` 数字、`body` 栈 |
| `control.forever` | 控制 | 无限循环（靠「跳出循环」或「停止」退出） | `body` 栈 |
| `control.while` | 控制 | 条件为真时重复 | `condition` 布尔值、`body` 栈 |
| `control.repeatWith` | 控制 | 重复并计数，当前轮次从 1 开始写入变量 | `times` 数字、`body` 栈，属性 `variable` |
| `control.wait` | 控制 | 等待若干秒（可被「停止」中断） | `seconds` 数字 |
| `control.pass` | 控制 | 空语句，什么也不做 | — |
| `comment.note` | 注释 | 注释语句，运行时不产生任何效果 | 属性 `text` |
| `sys.exit` | 系统 | 立即结束整个程序 | `code` 数字状态码 |
| `control.throw` | 控制 | 抛出异常 | `value` 任意值 |
| `control.try` | 控制 | 尝试/捕获容器 | `body`、`catches` 栈 |
| `control.catch` | 控制 | 捕获任意异常（只能放在 try 的 catches） | `body` 栈 |
| `control.catchType` | 控制 | 按类型捕获 | 属性 `exception`，`body` 栈 |
| `control.catchAssign` | 控制 | 捕获并把错误信息写入变量 | 属性 `exception`、`target`，`body` 栈 |
| `io.print` | 输出 | 打印到控制台 | `text` 任意值 |
| `convert.toNumber` | 转换 | 把整段文本转成数值；含非数字内容报错 | `text` 文本 |
| `convert.toString` | 转换 | 把值转成字符串 | `value` 任意值 |
| `logic.boolean` | 逻辑 | 布尔字面量 | 属性 `value` |
| `logic.compare` | 逻辑 | 比较运算（`== != < <= > >=`） | 属性 `op`，`a`、`b` 值 |
| `math.number` | 数学 | 数字字面量 | 属性 `value` |
| `math.arithmetic` | 数学 | 四则运算（`+ - * / %`） | 属性 `op`，`a`、`b` 值 |
| `text.literal` | 文本 | 文本字面量 | 属性 `value` |
| `text.join` | 文本 | 连接两段文本 | `a`、`b` 值 |
| `var.set` | 变量 | 给变量赋值 | 属性 `variable`，`value` 值 |
| `var.get` | 变量 | 读取变量 | 属性 `variable` |
| `list.literal` | 列表与字典 | JSON 列表字面量 | 属性 `items`，如 `[1, 2, 3]` |
| `list.length` / `list.get` | 列表与字典 | 长度 / 按 0 起始下标取值 | `items` 列表，`index` 数字 |
| `list.add` / `list.set` | 列表与字典 | 末尾追加 / 替换某项 | `items`、`index`、`value` |
| `dict.literal` | 列表与字典 | JSON 字典字面量 | 属性 `items`，如 `{"name": "Ada"}` |
| `dict.get` / `dict.has` | 列表与字典 | 按键取值 / 判断键存在 | `dict`、`key` |
| `dict.keys` / `dict.set` | 列表与字典 | 所有键（列表）/ 按键写入 | `dict`、`key`、`value` |
| `func.define` | 函数 | 定义函数（hat，函数体为 `body` 栈） | 属性 `name`、`params`（`名称: 类型`）、`returnType`，`body` 栈 |
| `func.param` | 函数 | 读取当前函数的一个参数 | 属性 `name` |
| `func.return` | 函数 | 立即返回，可带结果 | `value` 值 |
| `func.call:<函数块 id>` | 函数 | 动态生成的调用块（无返回值时为语句，否则为表达式） | 每个参数一个值端口 |
| `file.read` | 文件 | 读取文本文件（绝对路径、`~/…` 或主目录相对路径） | `path` |
| `file.write` | 文件 | 写入（覆盖）文本文件 | `path`、`content` |
| `file.exists` | 文件 | 文件是否存在 | `path` |
| `file.delete` | 文件 | 删除文件 | `path` |
| `file.list` | 文件 | 列出文件夹中的文件名（列表，留空为主目录） | — |

类别颜色在 `packages/engine/src/blocks/control.ts` 的 `CATEGORY_COLORS` 中定义（其他积木文件从这里导入）；工具箱顺序由 `packages/engine/src/registry.ts` 的 `CATEGORY_ORDER` 决定。

## 执行上下文

`ExecutionContext` 是积木能接触到的全部能力：

```ts
interface ExecutionContext {
  readonly project: Project;
  readonly host: HostBridge;
  readonly signal: AbortSignal;
  evaluate(node: BlockNode): Promise<Value>;          // 执行表达式子树
  input(node: BlockNode, port: string): Promise<Value>; // 端口值（含内联字面量）
  literal(node: BlockNode, port: string): Value;      // 端口内联字面量
  stack(node: BlockNode, port: string): BlockNode[];  // 栈端口里的语句
  run(blocks: BlockNode[]): Promise<void>;            // 顺序执行一组语句
  getVariable(id: string): Value;
  setVariable(id: string, value: Value): void;
  getParam(name: string): Value;                      // 函数参数（仅函数体内）
  callFunction(id: string, args: Value[]): Promise<Value>;
  coerce(value: Value, type: ValueType, blockId: string): Value;
  variableName(id: string): string;
  print(value: Value, blockId?: string): void;        // 走 HostBridge，产出 log 事件
  tick(): Promise<void>;                              // 记一步，超限/停止时抛错
  sleep(ms: number): Promise<void>;                   // 可被停止打断的等待
  fail(messageKey: string, params?: Record<string, string | number>): never;
}
```

约定：积木**不要**直接碰 `document`、DOM、文件系统或网络；所有副作用都通过 `ctx.host.invoke({ capability, args, blockId })`。这样宿主可以做权限控制，测试也可以注入假宿主。

## 等待

`control.wait` 读取 `seconds`（允许小数），调用 `ctx.sleep(seconds * 1000)`。等待期间不占步数；「停止」通过 `AbortSignal` 立即打断并让整次运行以 `stopped` 结束。宿主实现可以换成真实定时器或虚拟时钟（测试里注入 `ctx.host`/缩短时长即可）。

## 列表与字典

- 值就是纯 JSON：`Value[]` 与 `{ [key: string]: Value }`，可以跨进程传输、直接序列化。
- 字面量积木把文本字段按 JSON 解析；格式不符会抛出可翻译错误 `runtime.error.badJson`。
- `list.add`、`list.set`、`dict.set` 就地修改容器（引用语义）；需要保留旧值应先复制。下标越界会抛 `runtime.error.badIndex`。
- 变量本身可以声明为 `list` / `dict` 类型（新建变量对话框里选择），`var.get` 返回的就是同一个容器。

## 函数

函数是**画布上的 hat 积木**，不是单独的表单：

1. 从「函数」类别拖出 `func.define`，在属性面板填 `name`、`params`（如 `x: number, label: text`）和 `returnType`。
2. 函数体直接嵌在它的 `body` 栈里；用 `func.param` 读取参数，`func.return` 返回值（不写则返回返回类型的默认值）。
3. `func.define` 以**积木 id** 标识函数；调用块类型是 `func.call:<id>`，由 `createProjectRegistry(project)` 根据当前定义动态生成，因此重命名函数后调用块标签会自动更新。
4. 参数只在该函数体内可见（无闭包、无全局隐式参数）；嵌套调用上限 64 层，超出报 `runtime.error.callDepth`。
5. 删除函数定义时，编辑器会同时移除所有调用块，避免留下悬空引用。

`runProject` 默认用 `createProjectRegistry(project)` 构建注册表；`defaultRegistry` 只含核心积木（不含调用块）。

## 注册与校验

```ts
const registry = createProjectRegistry(project); // 核心积木 + 从项目定义生成的调用块
registry.get("io.print");   // BlockDefinition | undefined
registry.all();             // 按类别与类型排序
registry.grouped();         // 按类别分组，供工具箱
```

`validateProject` 接受任意 `BlockSchema` 来源；IR 侧会额外扫描 `func.define`，校验参数列表与 `func.param` 的作用域。插件可以传入自己的注册表，不影响核心。

## 新增一块积木

1. 在 `packages/engine/src/blocks/` 新文件（或现有文件）里写 `BlockDefinition`。
2. 加入 `src/registry.ts` 的 `coreBlocks` 数组；新类别同时更新 `CATEGORY_ORDER` 与 `CATEGORY_COLORS`。
3. 在中英文语言包里加 `block.<type>.label`、`block.<type>.description` 以及字段/端口标签。测试会检查两种语言的 key 对齐。
4. 在 `packages/engine/test/` 加执行用例（正常路径 + 错误路径），必要时补 IR 校验用例。
5. 编辑器不需要改动：工具箱、画布、属性面板都从 schema 生成。

## 快照与不可变性

注册表在构造后视为不可变；积木定义里的数组（`fields`、`ports`）不应被运行时修改。文档树本身是可变的（编辑器就地修改以节省内存），但引擎在运行期间只读。

## 循环语义

- `control.repeat`：先把 `times` 求值为非负整数，再重复执行 `body`。
- `control.forever`：每轮先 `tick` 再执行 `body`；`BreakSignal` 退出循环；仍受 `stepLimit` 限制，不会把运行器卡死。
- `control.while`：每轮开始前重新求值 `condition`，为假就结束；条件里的变量或函数调用会随轮次变化。
- `control.repeatWith`：先固定 `times`，然后第 1..N 轮把轮次写入 `variable`（1 起）；循环结束后变量保留最后一轮的值；`break` 时立即停止并保留当前值。

## 类型转换

- `convert.toNumber`：先修剪首尾空白，再要求整段文本是十进制数字（可选正负号、小数点、指数，如 `-12.5`、`1e3`）。`12abc`、空串、`Infinity` 等都会以 `runtime.error.toNumber` 报错，参数 `{value}` 保留原文本。数值输入直接透传。
- `convert.toString`：用与 `io.print` 一致的显示规则把值转成文本；数值 123 → `"123"`，列表/字典输出 JSON 形式。

## 程序退出

`sys.exit` 立即终止整次运行，后续脚本与语句都不再执行，也不会被 `control.try` 捕获。

- 状态码为 `0`：等价于正常结束，结果状态为 `finished`。
- 状态码非 `0`：以出错状态结束，错误键为 `runtime.error.exitCode`，参数 `{code}` 保留退出码。

当前版本还没有编译目标，所以它只是运行器的终止语义；等以后能编译成真实程序时，再映射为进程的真实退出码。

## 跳出循环

`control.break` 抛出内部 `BreakSignal`，只由循环积木捕获（`control.repeat`、`control.forever`、`control.while`、`control.repeatWith`）。如果在循环外执行，整次运行以 `runtime.error.breakOutsideLoop` 报错。`func.return` 用同一套控制流信号，两者都会安全穿过 `control.if` 等普通语句。

## 错误处理

`control.throw` 抛出 `ThrowSignal(value)`；`control.try` 执行 `body`，捕获 `ThrowSignal` 和 `RuntimeFailure`，按 `catches` 顺序用分支的 `exception` 字段匹配：

- `any` 匹配全部；`error` 只匹配运行时错误；其余按被抛出值的类型（`text`/`number`/`boolean`/`list`/`dict`）匹配。
- `control.catchAssign` 在匹配后调用 `ctx.setVariable(target, text)`，把异常转成当前语言的消息字符串；`RuntimeFailure` 的文本由运行入口注入的 `describeFailure` 本地化。
- 没有匹配分支时原样重抛；`StopSignal`、`BreakSignal` 永不捕获，保证「停止」和跳出循环语义不变。
- 校验要求捕获积木只能出现在 `control.try` 的 `catches` 栈中，且该栈只能放捕获积木（`catch.misplaced` / `catch.invalid`）。

## 文件操作

文件积木不直接碰磁盘，而是调用宿主能力 `fs.read` / `fs.write` / `fs.exists` / `fs.delete` / `fs.list`：

- **浏览器/编辑器**：宿主把文件存在 `localStorage` 的 `nexus-blocks:workspace-files` 里（注入 `storage` 才启用这组能力），刷新页面后文件仍在；路径是扁平名字，不支持目录。
- **路径规则**：统一用 `/`，禁止绝对路径、空段、`.`、`..` 和控制字符（`normalizePath`），违规报 `runtime.error.filePath`；单个文件上限 100 万字符。
- **桌面壳**：Tauri 宿主实现同名能力，直接读写本机文件系统，`fs.*` 不做根目录限制；语言层不用改。

读取不存在的文件报 `runtime.error.fileNotFound`，删除同样。
