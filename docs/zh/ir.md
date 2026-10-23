# 语言与 IR

`@nexus/ir` 定义了 Nexus Blocks 的**唯一语义来源**。编辑器、运行时、未来的文本视图与导出器都读写同一份 IR；图形只是它的一种渲染方式。

## 文档（`NexusDocument`）

```json
{
  "format": "nexus-blocks/document",
  "version": 1,
  "project": {
    "format": "nexus-blocks/ir",
    "version": 1,
    "id": "prj_ab12cd",
    "name": "Untitled",
    "locale": "zh-CN",
    "createdAt": "2026-10-23T08:00:00.000Z",
    "updatedAt": "2026-10-23T08:00:00.000Z",
    "variables": [],
    "functions": [],
    "scripts": [
      {
        "id": "start_x9",
        "type": "control.start",
        "fields": {},
        "inputs": {
          "body": [
            {
              "id": "print_a1",
              "type": "io.print",
              "fields": { "text": "Hello, world!" },
              "inputs": {}
            }
          ]
        }
      }
    ],
    "metadata": {}
  },
  "editor": {
    "positions": { "start_x9": { "x": 80, "y": 96 } },
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }
}
```

要点：

- `project` 只描述语义（含变量、函数、脚本），`editor` 只描述画布状态（位置、视口）。运行时永远不读 `editor`。
- `scripts` 是**顶层 hat 块数组**，不是嵌套数组；脚本体在 hat 的 `inputs.body` 里。
- 属性（下拉选项、数字、文本）放在 `fields`；插槽（栈端口、值端口）放在 `inputs`。值端口未插块时，用同名的 `fields[port]` 存内联字面量。
- 未知字段会被序列化保留（`metadata`），未知块类型在校验时报错而不是静默丢弃。

## 值类型

`ValueType`：`any`、`void`、`text`、`number`、`boolean`、`list`，以及为函数预留的 `dict`。`Value` 是它们的 JSON 载体；`values.ts` 提供：

| 函数 | 作用 |
| --- | --- |
| `typeOf(value)` | 运行时取值类型，`null` 视为 `any` |
| `isAssignable(from, to)` | 端口类型检查（`text` 可接收数字/布尔，自动转文本） |
| `coerce(value, type)` | 宽松转换，返回 `{ ok, value }` 或 `{ ok: false, reason }` |
| `defaultValue(type)` | 类型默认值（`""`、`0`、`false`、`[]`、`null`） |
| `toDisplayText(value)` | 控制台显示用的字符串 |
| `truthy(value)` | 条件判断语义：空文本/0/`null`/空列表为假 |

## 序列化

- `serializeDocument(doc)`：2 空格缩进、键排序、末尾换行、`viewport` 必有值。
- `parseDocument(input)`：接受字符串或对象，返回 `{ ok: true, document, warnings }` 或 `{ ok: false, error }`；缺省字段按 schema 补默认值，`warnings` 记录被修正的内容。
- `serializeProject` 供只需要语言部分的场景（CLI、测试）使用。

## 校验

`validateProject(project, schemaSource)` 返回 `Diagnostic[]`：

```ts
interface Diagnostic {
  severity: "error" | "warning";
  code: string;          // 例如 "block.unknownType"
  message: string;       // 英文调试信息，UI 用 messageKey 翻译
  path: string;          // 例如 "scripts[0].inputs.body[1]"
  blockId?: string;
  params?: Record<string, string | number>;
}
```

覆盖的检查：文档/项目版本与格式、变量命名（Unicode 字母/数字/下划线）与重名、空脚本、块 id 重复、未知块类型、hat/statement/expression 位置不匹配、必填字段缺失、数字/选项/变量字段非法、端口类型不匹配（`port.typeMismatch`）。

`errorsOnly` / `hasErrors` 便于在保存、运行前快速判断。

## 遍历与克隆

- `walkProject(project, visit)` / `walkBlocks(blocks, visit)`：带路径、父块、端口与索引的深度遍历。
- `findBlock(project, id)`、`locateBlock`（在编辑器侧）：按 id 定位。
- `cloneBlock(block)`：生成新 id，深拷贝整棵子树，供复制/拖拽使用。

## 版本策略

- 文档 `version: 1`、项目 `version: 1`，读取更高版本会拒绝。
- 新字段一律可选，缺省补默认值；删除字段前先在 `parseDocument` 里迁移。
- `metadata` 是扩展位，扩展方自担命名空间（例如 `metadata["com.example.plugin"]`）。
