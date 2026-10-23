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

## 内置积木（12）

| 类型 | 类别 | 说明 | 插槽 / 属性 |
| --- | --- | --- | --- |
| `control.start` | 控制 | 程序入口（hat） | `body` 栈 |
| `control.if` | 控制 | 条件分支 | `condition` 布尔值，`then`、`else` 栈 |
| `control.repeat` | 控制 | 重复执行 | `times` 数字、`body` 栈 |
| `io.print` | 输入输出 | 打印到控制台 | `text` 任意值 |
| `logic.boolean` | 逻辑 | 布尔字面量 | 属性 `value` |
| `logic.compare` | 逻辑 | 比较运算（`== != < <= > >=`） | 属性 `op`，`a`、`b` 值 |
| `math.number` | 数学 | 数字字面量 | 属性 `value` |
| `math.arithmetic` | 数学 | 四则运算（`+ - * / %`） | 属性 `op`，`a`、`b` 值 |
| `text.literal` | 文本 | 文本字面量 | 属性 `value` |
| `text.join` | 文本 | 连接两段文本 | `a`、`b` 值 |
| `var.set` | 变量 | 给变量赋值 | 属性 `variable`（变量引用），`value` 值 |
| `var.get` | 变量 | 读取变量 | 属性 `variable` |

类别颜色在 `packages/engine/src/blocks/control.ts` 的 `CATEGORY_COLORS` 中定义（其他积木文件从这里导入）；工具箱顺序由 `packages/engine/src/registry.ts` 的 `CATEGORY_ORDER` 决定。

## 执行上下文

`ExecutionContext` 是积木能接触到的全部能力：

```ts
interface ExecutionContext {
  readonly project: Project;
  readonly host: HostBridge;
  readonly signal: AbortSignal;
  evaluate(block: BlockNode): Promise<Value>;   // 执行表达式子树
  input(block: BlockNode, port: string): Promise<Value>; // 端口值（含内联字面量）
  literal(node: BlockNode, port: string): Value; // 端口内联字面量
  stack(block: BlockNode, port: string): Promise<void>;  // 执行语句栈
  run(block: BlockNode): Promise<void>;         // 执行单个语句
  getVariable(id: string): Value;
  setVariable(id: string, value: Value): void;
  coerce(value: Value, type: ValueType): Value; // 失败会抛运行时错误
  variableName(id: string): string;
  print(value: Value, blockId?: string): void;  // 走 HostBridge，产出 log 事件
  tick(): void;                                  // 记一步，超限抛错
  fail(messageKey: string, params?: Record<string, string | number>): never;
}
```

约定：积木**不要**直接碰 `document`、DOM、文件系统或网络；所有副作用都通过 `ctx.host.invoke({ capability, args, blockId })`。这样宿主可以做权限控制，测试也可以注入假宿主。

## 注册与校验

```ts
const registry = new BlockRegistry([...coreBlocks]);
registry.get("io.print");   // BlockDefinition | undefined
registry.all();             // 按注册顺序
registry.grouped();         // 按类别分组，供工具箱
```

`defaultRegistry` 已注册全部内置积木。`validateProject` 接受任意 `BlockRegistry`（或 `BlockSchema` 来源），因此插件可以在自己的一套积木集上校验，而不影响核心。

## 新增一块积木

1. 在 `packages/engine/src/blocks/` 新文件（或现有文件）里写 `BlockDefinition`。
2. 加入 `src/blocks/index.ts` 的 `coreBlocks` 数组；如果需要新类别，同时更新 `CATEGORY_ORDER` 与 `CATEGORY_COLORS`。
3. 在中英文语言包里加 `block.<type>.label`、`block.<type>.description` 以及字段/端口标签。测试会检查两种语言的 key 对齐。
4. 在 `packages/engine/test/` 加执行用例（正常路径 + 错误路径），必要时补 IR 校验用例。
5. 编辑器不需要改动：工具箱、画布、属性面板都从 schema 生成。

## 快照与不可变性

注册表在构造后视为不可变；积木定义里的数组（`fields`、`ports`）不应被运行时修改。文档树本身是可变的（编辑器就地修改以节省内存），但引擎在运行期间只读。
