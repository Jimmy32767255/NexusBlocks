# `.nblk` 文本格式

Nexus Blocks 的程序文件使用 `.nblk` 后缀，内容是一段类 Python 的纯文本，而不是 JSON。编辑器保存时写 `.nblk`；打开时优先按 `.nblk` 解析，旧的 `.nexusblocks.json` 仍然可以读取。

```text
project "Hello, world!"
locale zh-CN

start:
  print "Hello, world!"
```

IR 仍是唯一的事实来源：`.nblk` 只是 IR（`project.scripts`）的一种可读表示。解析会生成与图形编辑完全相同的文档，两种视图可以互相转换，语义不变。

## 基本结构

1. 文件头：`project "项目名"`，可选一行 `locale zh-CN` 或 `locale en`。
2. 变量区（可选）：
   ```text
   variables:
     score: number = 0
     names: list = ["a", "b"]
     info: dict = {"k": 1}
   ```
   类型支持 `any`、`text`、`number`、`boolean`、`list`、`dict`；初始值必须是 JSON 字面量（列表中可嵌套对象/数组）。
3. 顶层积木：`start:`、`define`、`import`，按书写顺序决定脚本顺序。
4. 缩进表示嵌套，两个空格；空行与 `#` 开头的行会被忽略。

## 语句

```text
start:
  print "Hello"
  print score
  set score to score + 1
  wait 0.5
  note "一条注释"
  throw "boom"
  exit 0
  run "echo hi"
```

| 积木 | 文本写法 |
| --- | --- |
| 等待 | `wait 0.5` |
| 输出 | `print expr` |
| 变量赋值 | `set 变量 to expr` |
| 抛出 | `throw expr` |
| 退出程序 | `exit expr` |
| 执行系统命令 | `run expr` |
| 注释 | `note "text"` |
| 标记 | `label name`（名称有空格时写 `label "with space"`） |
| 跳转 | `goto name` |
| 跳出循环 | `break` |
| 返回 | `return expr`（仅函数体） |
| 未知积木 | `raw {"type": "...", "fields": {...}}` |

## 控制流

```text
  if score > 2:
    print "big"
  else if score == 2:
    print "two"
  else:
    print "small"

  repeat 3:
    print "again"

  while score < 10:
    set score to score + 1

  repeat with i times 2:
    print i

  forever:
    break
```

## 错误处理

```text
  try:
    throw "boom"
  catch:
    print "caught"
  catch text as message:
    print message
```

`catch` 可跟类型（`error`/`text`/`number`/`boolean`/`list`/`dict`/`any`）；`as 变量名` 会把错误信息写入该变量，变量不存在时会自动声明为 `text`。

## 函数

```text
define value square(x: number) -> number:
  return x * x

define action greet(name: text):
  print join("Hello, ", name)
```

- `define value` 返回值，可作表达式使用；`-> 类型` 省略时默认 `any`。
- `define action` 返回 `void`，不能写 `return 值`。
- 参数在函数体内可直接按名字使用。
- 调用写法就是普通函数调用：`print square(3)`、`greet("nexus")`；参数作为语句时也可直接写 `greet("nexus")`。

## 导入

```text
import "lib.nblk"
from "lib.nblk" import greet
from "lib.nblk" import greet as hi
```

路径字符串与文件能力一致：绝对路径、`~/…`、或主目录相对路径。导入只合并函数定义与变量，不执行被导入文件的顶层脚本。

## 表达式

支持：

- 字面量：`"text"`、`42`、`-1`、`true`、`false`、`null`、`[1, 2]`、`{"k": 1}`
- 变量名与函数参数名
- 一元 `-`、`not`
- 二元 `+ - * / %`、`== != < <= > >=`、`and`、`or`
- 函数调用：`name(arg1, arg2)`
- 列表/字典读取：`items[0]`、`dict["key"]`
- 内置函数式写法：
  `join(...)`、`toNumber(x)`、`toString(x)`、`length(x)`、`add(list, x)`、`setitem(list, i, x)`、`setkey(dict, k, v)`、`getkey(dict, k)`、`haskey(dict, k)`、`keysof(dict)`、`contains(text, sub)`、`split(text, sep, n)`、`readfile(path)`、`exists(path)`、`listfiles()`、`time()`、`square(x)`

未知但带专属文本写法的积木会退回 `raw(...)` / `raw {...}`，便于手动编辑或未来扩展；`raw` 内容必须是合法的积木 JSON。

## 与 JSON 的关系

- 打开旧 `.nexusblocks.json` 仍可用。
- 自动保存（浏览器 `localStorage`）内部仍使用 JSON，属于实现细节；导出/保存文件是 `.nblk`。
- 每个 `.nblk` 解析后都经过与图形编辑相同的校验（变量存在、端口类型、函数定义合法等），错误信息带行号，例如 `Line 4: Unknown variable: nope`。
