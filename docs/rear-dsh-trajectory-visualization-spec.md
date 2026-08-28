# REAR 轨迹展示 1:1 对齐 DSH Spec

- 状态：Implemented
- 日期：2026-08-21
- REAR 基线：`35a2c21207c1838f3227c5fe0ef8d81917e5c2d9`
- DSH 基线：`deepseek-harness@99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- DSH 包：`@deepseek-ai/dsh-client-ui-trajectory@0.1.1-rc.2`
- 数据契约：RunRecord V1、TrajectoryRef V2、canonical DSH session version 0

## 1. 结论

REAR 当前的 canonical 轨迹是自定义事件卡片列表；DSH 是由以下部分组成的紧凑轨迹工作台：

```text
Trajectory toolbar                         32 px
Input / Model / Tools overview timeline    50 px
┌──────────────── ledger ────────────────┬─ local inspector ─┐
│ Turn rail + Request marker             │ tabs + detail     │
│ Role tag      one-line content         │ summary/payload   │
│ ASSISTANT     answer                    │ usage/timing      │
│ TOOL          args  →  result           │ schema/raw        │
└────────────────────────────────────────┴───────────────────┘
```

本次修改必须按固定 DSH commit 的组件结构、投影语义、尺寸和交互进行源码级移植，不再基于 DSH “重新设计一套相似 UI”。

`Canonical View` 内不保留 REAR 当前的 `.event-card` 展示。REAR 只保留轨迹组件外层的 benchmark/run 对比能力，以及 DSH 本身没有的 Provider Evidence 入口和多 run 同步滚动。

## 2. 目标

1. 同一份 canonical session 在 REAR 和 DSH 中产生相同的 Turn、Request、Assistant、Tool 行顺序及生命周期状态。
2. REAR 的单条轨迹视图在结构、密度、颜色语义、折叠、搜索、timeline 和 inspector 行为上与固定 DSH 基线一致。
3. Tool call/result 合成一行；assistant chunks/final message 合成一行，不再按原始 event 逐卡片展示。
4. 1–4 条轨迹仍可在 REAR 中并排比较，每条 lane 内部都是一个独立 DSH trajectory surface。
5. 缺失 timing、usage、schema 或 output 时保留 DSH 的“未知/未记录”语义，不显示伪造的 `0`。

## 3. 非目标

- 不改变 Overview、Breakdown、strict comparison、reward/verifier 和 run summary 的产品逻辑。
- 不改变 Provider Evidence 的分页和原始文件查看方式。
- 不引入 DSH 的 Cordis、conversation shell、composer、client runtime 或插件加载器。
- 不重新支持 TrajectoryRef V1、Harbor trial 旧日志或 `hitch-events.jsonl` fallback；存储发现逻辑以 `docs/rear-run-centered-storage-adaptation-spec.md` 为准。
- 不为 finalized canonical artifact 伪造 live streaming、older-history pagination、running duration 或 composer overlay。
- 不提前实现 canonical contract 中不存在的 compaction、retry、subtool/code-dispatch 或 subagent UI。

## 4. 唯一允许的差异

“1:1 对齐”允许的差异只有以下六项：

1. DSH 组件由 `Session` store 取数；REAR 由 `/api/hitch-trajectory` 返回的已校验 canonical document 取数。
2. DSH design tokens 以 dark theme 的实际值复制并限定在轨迹 surface 内，避免污染 REAR 外壳。
3. DSH primitives（Tooltip、MarkdownText、JsonTree、图标）使用 REAR 本地适配器，但 DOM 语义、视觉尺寸和交互保持一致。
4. DSH 针对 viewport 的 inspector 窄屏规则，在 REAR 中改为针对单条 lane 的 container query；阈值仍为 `760px`，ledger role tag 的 `620px` 阈值不变。
5. REAR 在 DSH surface 外保留 lane header、run summary、Canonical/Provider 切换和同步滚动开关。
6. finalized artifact 没有 earlier-history/live partial 时，不渲染 DSH 的 history loading control；其余布局不得因此改变。

除上述白名单外，任何新增列、卡片、筛选器、抽屉、颜色体系或交互都视为不符合本 spec。

## 5. 明确禁止的替代实现

| 禁止方案 | 原因 |
| --- | --- |
| 继续使用 `.event-card`，只修改颜色和间距 | DSH 的核心是 lifecycle record ledger，不是 event card。 |
| 把 tool call 与 tool result 分成两行 | 与 DSH record 语义不一致。 |
| 为每个 `assistant/chunk` 建一行 | DSH 在同一 Assistant lifecycle 内组装 chunks。 |
| 增加 `# / Event / Content / Time` 表头 | 当前 DSH ledger 没有 column header，只有两列布局。 |
| 增加可见的 `Step N` header row | 当前 DSH 通过 Request marker 和 inspector location 表达 Step。 |
| 使用 Compare 级共享 toolbar | DSH 的搜索、Turn/Call 折叠和选中状态属于单条轨迹。 |
| 使用跨所有 lane 的共享 drawer | DSH inspector 位于当前 trajectory surface 内部。 |
| 保留“全部 / 动作 / 错误”过滤器 | DSH 没有该过滤器；只提供搜索、timeline focus 和折叠。 |
| timeline 选区直接删除未命中记录 | DSH 只降低选区外行的透明度，不过滤 ledger。 |
| 用当前时间计算 running duration | DSH 对进行中且无完成时间的记录显示未知。 |

## 6. 数据契约

### 6.1 当前问题

当前 `lib/hitch/canonical-session.ts` 把 session 压成扁平 `CanonicalLedgerRecord[]`：

- request/header、Turn 和 Step 信息被丢弃；
- tool call/result 成为两条记录；
- assistant lifecycle 被拆成 chunk/message 记录；
- source blocks、prompt、tool schema、reasoning 和 request detail 无法供 DSH inspector 使用。

因此只替换 React/CSS 无法达到 DSH 展示效果，必须先停止生成这个扁平 UI 模型。

### 6.2 Detail API

`GET /api/hitch-trajectory?run=<run-id>&view=canonical` 继续只接受已索引 run id，并继续使用 canonical file SHA-256 作为 ETag。响应改为保留已校验 session events：

```ts
interface CanonicalTrajectoryDocument {
  runId: string
  session: SessionHeaderLine
  summary: CanonicalTrajectorySummary
  records: Array<SessionEvent | PackedAssistantChunkRun>
}
```

移除旧的扁平 UI `CanonicalLedgerRecord`。完整 events 只在用户打开 Compare 后加载当前 1–4 条 run，不回到 `/api/hitch-data` summary payload。为了不让 token 级 `assistant/chunk` 把 RPC 体积放大，连续 delta 在传输层使用 DSH 的无损 chunk-row 格式打包；浏览器在交给 DSH projector 前恢复为原始、seq/time 不变的 SessionEvent。

### 6.3 DSH adapter

浏览器端增加纯函数：

```ts
buildDshTrajectorySnapshot(
  header: SessionHeaderLine,
  events: readonly SessionEvent[],
): DshTrajectorySnapshot
```

该函数按固定 DSH commit 中以下源码的语义移植：

- `trajectory-message-definitions.ts`
- `trajectory-assistant-definition.ts`
- `trajectory-tool-definition.ts`
- `trajectory-request-header-definition.ts`
- `trajectory-snapshot-builder.ts`
- `layout.ts`

输出必须包含 DSH layout 所需的 `eventNodes`、`eventLocations`、`requests`、`callSchemas`、`partial` 和 `runningCalls`。finalized REAR artifact 的 `partial` 固定为 `null`，`runningCalls` 正常应为空；不得因此删掉 layout 对这两个字段的接口。

### 6.4 Lifecycle 规则

| canonical event | DSH 对齐行为 |
| --- | --- |
| `turn/start`, `turn/end` | 建立 Turn 边界和结束错误；不生成普通 ledger row。 |
| `step/start`, `step/end` | 建立 Assistant request 生命周期和 Step location；不生成普通 ledger row。 |
| `request/header` | 生成初始 SYSTEM 或 prompt update，并为 request inspector 提供 prompt、tools、config 和 provenance。 |
| `user/message` source=user | USER record。按 DSH 规则归入后续 Assistant 所属 Turn。 |
| `user/message` 其他 source | CONTEXT record，保留 source、content blocks 和 provenance。 |
| `assistant/chunk` | 更新同一 `(turn, step)` Assistant 状态、首 token 时间、blocks 和 usage；不单独成行。 |
| `assistant/message` | 完成 ASSISTANT record；最终 blocks 为权威内容。 |
| `tool/call` | 以 `callId` 创建 TOOL lifecycle，保留 name、arguments、turn、step、start time。 |
| `tool/result` | 合并到同一个 TOOL row，填充 result blocks、error 和 duration。 |
| unknown + `ignorable: true` | 保留在 raw session，不进入主 ledger。 |
| unknown required event | canonical detail 判为 unsupported/corrupt，不猜测展示。 |

record identity 必须使用 DSH 的稳定策略：显式 `recordId` 优先，其次 `callId`、source `seq`，最后才允许 index fallback。React key、virtual row key、搜索命中、折叠和 inspector selection 必须共享该 identity。

### 6.5 Timing 与 usage

- Assistant start：`step/start.time`。
- Assistant first token：第一个产生可见 token/reasoning delta 的 `assistant/chunk.time`。
- Assistant completed：final `assistant/message.time` 或明确的 step/turn interruption boundary。
- TTFT：`firstTokenTime - stepStartTime`；没有 chunk 时为 unknown，不得从 `turn/start` 推算。
- Tool duration：`tool/result.time - tool/call.time`。
- Input/Output/Cache/Reasoning token 按 DSH request usage 字段展示；字段缺失与数值 `0` 必须区分。
- timeline 只有在 start/duration 可用时才使用 recorded-time span；未知 timing 的 record 在 sequence 模式仍可见。

## 7. UI 结构与精确尺寸

每条 canonical lane 的结构固定为：

```text
REAR lane header                         # REAR-only
└─ DshTrajectorySurface
   ├─ TrajectoryToolbar
   ├─ TrajectoryTimeline
   └─ TrajectoryTableSplit
      ├─ Ledger table pane
      └─ Local Event details inspector
```

DSH surface 使用 DSH dark-theme token 值和字体栈，不继承 REAR 的 lime accent。必须保留以下尺寸：

| 元素 | DSH 基线 |
| --- | ---: |
| Toolbar | `32px` |
| Toolbar action | `20px` |
| Search | `22px` 高，目标宽度 `164px` |
| Timeline | `50px` |
| Timeline labels | `44px` 宽 |
| Timeline span | `8px` 高，三 lane 间距 `14px` |
| Normal ledger row | `30px` |
| Collapsed summary row | `20px` |
| Event column | `122px`；lane ≤ `620px` 时 `50px` |
| Role tag | `19px` 高 |
| Inspector | 默认 `clamp(320px, 38%, 440px)`；可拖到 `720px`，ledger 至少保留 `280px` |
| Inspector header | `42px` |
| Inspector tabs | `34px` |
| Virtualization | `>100` records；overscan `12` rows；估算 viewport `600px` |

不渲染 ledger column header。每个普通 row 只有：

```text
[Turn/Request rails + role tag] [single-line content]
```

Tool row 的 content 使用 DSH 的双区布局：左侧 tool name + args，右侧 `→ result`；error result 使用 error token。窄 lane 下 role label 折叠为图标，tooltip 在图标 hover/focus 时出现。

## 8. Toolbar

每条 lane 独立渲染 DSH toolbar，顺序固定为：

1. `Duration`
2. `Turns`
3. `Calls`
4. `Search`

`Actual time` control 与 DSH 一样保留在实现中但保持 hidden。

- `Duration` 在 sequence/equal-width 与 recorded-duration/compressed-idle 之间切换。
- duration preference 使用 DSH 的 browser-wide 语义；任一 lane 切换后所有 lane 同步反映。
- `Turns` 折叠每个可折叠 Turn：保留第一条内容 row，再增加 `N steps · M tool calls` summary row。
- `Calls` 只折叠紧跟在 Assistant 后面的 Tool/Subtool rows，summary 显示数量和 tool names。
- 单个 Turn 可通过 DSH 相同的双击规则折叠/展开；单个 Assistant 的 calls 也使用相同双击规则。
- Search 为大小写不敏感、空格分词、所有 term AND 匹配；范围与 DSH search index 一致。
- 搜索期间 ledger 只保留命中 record，timeline 保留全域并降低未命中 span 的透明度；清空搜索后恢复原折叠状态。

删除当前 canonical toolbar 中的“全部 / 动作 / 错误”。同步滚动开关可保留在所有 lane 外的 REAR compare control 中。

## 9. Overview timeline

timeline 必须直接移植 `TrajectoryTimeline.tsx`、`timeline.ts` 和对应 CSS 的行为：

- 三行固定为 `Input / Model / Tools`。
- USER/SYSTEM/CONTEXT 位于 Input；ASSISTANT 位于 Model；TOOL 位于 Tools。
- Turn boundary 是贯穿 timeline 的竖线。
- Assistant 同时有 TTFT 和 decoding 时间时，span 使用两段渐变。
- error span 使用 error color；当前 record 有独立 outline。
- hover `500ms` 后显示 role、绝对时间、total duration，以及可用的 TTFT/Decoding。
- 左键拖动建立 inclusive focus range；选区外 ledger row 降到 `0.24` opacity，不删除 row。
- 点击 span 清除 range、选择对应 row、滚动到该 row 并打开 inspector。
- 点击空白建立最小 range，并把最近 record 滚入视图。
- wheel 以指针为锚缩放；右键拖动在已缩放域内平移。
- 右键单击、双击或 `Escape` 清除 range；清除 range 不重置 zoom。
- 无可投影数据时仍保留 toolbar/timeline，并显示 `No timing data`。

REAR 多 lane 不共享 timeline zoom、range、hover 或 selected record；这些状态与 DSH 一样属于单条 trajectory view。

## 10. Ledger

### 10.1 Row 类型与颜色

角色闭集及颜色语义与 DSH 一致：

- SYSTEM：neutral
- USER：business blue
- CONTEXT：success green
- ASSISTANT：violet/red mix
- TOOL：amber
- ERROR：状态覆盖为 red，但不改变原 role

当前 Hitch contract 尚无 COMPACTED/SUBTOOL 时不得制造这两类 row；adapter 接口保留扩展位。

### 10.2 Turn 与 Request

- 每个 Turn 第一条普通 record 左上显示 `Turn N`；lane ≤ `620px` 时显示 `#N`。
- Turn 之间使用 `2px` rule，选中 Turn 显示贯穿 rows 的 rail。
- 每个 Assistant request 在对应 row 左侧显示圆点 marker，hover/focus 显示 `Request #N`。
- 连续重试或重合 request marker 按 `8px` 水平偏移排列。
- marker 可独立选中 Request inspector，不等同于选中普通 row。
- Step 不额外占一行；它通过 request marker 和 inspector 中的 `Turn N · Step N` 表达。

### 10.3 Selection 与滚动

- row click 或键盘 `Enter`/`Space` 选中 record 并打开本 lane inspector。
- selection rail 为 `3px`；error record 使用 error color。
- 打开由 timeline/call link 指定的 record 时，必须自动展开其 Turn/Calls 并居中滚动。
- completed artifact 初次打开按 DSH 行为定位到 ledger tail；用户向上滚动后不得被状态刷新拉回尾部。
- 超过 100 records 使用 `@tanstack/react-virtual`；stable key、ARIA row index、折叠 summary height 和滚动锚点逻辑与 DSH 一致。

## 11. Local inspector

Inspector 必须位于被选中 lane 的 `TrajectoryTableSplit` 内，不使用 Compare 级 drawer。

- 宽 lane：右侧 split pane。
- lane ≤ `760px`：覆盖在该 lane 右侧，宽度 `min(92%, 420px)`。
- 左边缘可拖动 resize；双击恢复默认；键盘左右键以 `16px` 调整。
- 点击关闭按钮只关闭 inspector，不清除 timeline zoom。
- inspector header 显示 role/request、`Turn N · Step N` location；普通 record 与 Request marker 使用不同标题。

Tabs 与 DSH 基线一致：

| 选择对象 | Tabs |
| --- | --- |
| Initial SYSTEM | `System Prompt`, `Tools` |
| Updated SYSTEM | `Diff`, `System Prompt`, `Tools` |
| USER / CONTEXT / ASSISTANT | `Summary`, `Preview`, `Raw`，有 source 时再加 `Source` |
| TOOL | `Summary`，有值时加 `Payload` / `Result`，始终有 `Schema`, `Timing` |
| Request marker | `Summary`，有 config 时加 `Options`，以及 `Usage`, `Timing` |

Assistant Summary 必须展示 rendered output、可折叠 Thinking、tool-call links、images、token 和 timing。Tool Summary 必须同时保留 payload/result，不允许 output 覆盖 input。单 text JSON result 使用 JSON tree；普通文本保持 pre-wrap；Markdown 内容在 Preview 中渲染。

图片仅允许 DSH/REAR 已认可的安全 scheme；不安全 URL 作为文本展示。不存在的数据使用 DSH 对应文案（如 `Usage not reported`、`Schema unavailable`、`Not recorded`），不得构造空对象。

## 12. REAR Compare 集成

- Compare heading、strict/exploratory banner、insights、run summaries 和 Canonical/Provider tabs 保留。
- `.trace-lane > header` 保留为 REAR lane 标识；其下不再有 `.trace-scroll`/`.event-card`，而是固定高度的 DSH surface。
- 1 条 run 使用可用全宽；2–4 条 run 继续横向 grid/scroll。每条 lane 最小宽度不小于 `300px`，DSH 的 `620px`/`760px` responsive 行为改为 lane container query。
- `同步滚动` 仅同步各 lane 的 ledger table pane，继续使用比例同步；不得同步 inspector、timeline zoom、range、search、fold 或 selection。
- Provider Evidence 仍使用现有 REAR panel，不套 DSH trajectory UI。
- canonical 为 missing/pending/raw_only/corrupt/unsupported 时，在 lane 内显示 REAR empty state，不创建假的 DSH records。

## 13. DSH 原生运行时桥接策略

REAR 必须依赖并注入 `@deepseek-ai/dsh-client-ui-trajectory`，不复制其布局、timeline、table、inspector、搜索、折叠或虚拟列表源码。

- 从 `conversation.view` slot ledger 解析 `id=trajectory` 的原生组件；缺失时 fail loud。
- 使用 `ConversationNodeAssembler(ctx.conversationEvents, ctx.conversationViews)` 处理 Hitch canonical events，使事件定义、配对、prompt、timing、request 和 snapshot builder 与当前 DSH 运行时完全相同。
- 每条 REAR lane 只提供一个只读的最小 Session snapshot hook，`hasMore=false`，不得向真实 DSH session catalog 注入伪造会话。
- Duration、搜索、折叠、timeline range、selection 和 inspector 状态由每个原生 `TrajectoryView` 实例自行维护，不跨 lane 共享。
- REAR 只维护 canonical envelope 传递、lane 尺寸和 Provider Evidence 外壳。升级 DSH 后通过 bridge/integration tests 验证 slot id 与 snapshot contract；不得在 REAR 中复制新增行为。

## 14. 文件级改动

| 文件 | 修改 |
| --- | --- |
| `src/types.ts` | canonical detail 保留 Session header + raw validated events。 |
| `src/hitch-provider.ts` | 校验 canonical document；summary TTFT 使用真正的首 token delta。 |
| `src/client/RefinementView.tsx` | REAR lane header、empty state、Provider Evidence 和 DSH surface 编排。 |
| `src/client/DshOfflineTrajectorySurface.tsx` | 原生 slot component bridge 与只读 Session selector。 |
| `src/client/index.ts` | 使用 DSH registry/assembler 投影 canonical events，并注入 bridge。 |
| `src/client/styles.ts` | 只保留 lane 尺寸/隔离；轨迹内部样式由 DSH 包提供。 |
| `tests/plugin/offline-trajectory.spec.ts` | slot component 解析和 canonical envelope 无损转交测试。 |
| `tests/plugin/package-bundle.spec.ts` | assembler 依赖、原生 bridge 和旧 renderer 缺席断言。 |

## 15. 测试要求

### 15.1 Adapter parity

使用同一 session fixture 验证 canonical envelope 原样交给 DSH assembler：

- 多 Turn、多 Step、steering input。
- initial/update request header、prompt/tool catalog、request config。
- chunk + final Assistant、reasoning、tool-call-only Assistant。
- Tool success/error、JSON/text/image result、缺失 schema。
- 缺失 chunk/usage/timing 时的 unknown 语义。
- unknown ignorable 与 unknown required event。

REAR 不再生成 Turn、group 或 record；这些输出必须来自注册的 DSH snapshot builder。集成测试断言真实 run 的 node、request、call schema 数量及关键身份。

### 15.2 组件 parity

Toolbar、折叠、搜索、timeline、inspector 和 virtualization 的行为测试由 DSH `ui-trajectory` 包拥有，REAR 不复制。REAR 集成测试至少覆盖：

- `conversation.view` 中可解析唯一的 `id=trajectory` 原生组件。
- bridge 缺失组件或 snapshot builder 时 fail loud。
- 1–4 lane 各自持有独立的 duration/search/fold/timeline/selection/inspector 状态。
- bundle 不包含旧 REAR trajectory table/inspector 实现。

### 15.3 Visual regression

建立 deterministic fixture，并分别在 DSH reference app 与 REAR 中截取只包含 trajectory surface 的截图：

- 单 lane：`1280 × 720`。
- 单 lane 窄态：`600 × 720`。
- Tool inspector 打开态。
- Request inspector 打开态。
- timeline selection + search + collapsed calls 态。

验收优先检查 DOM 结构、尺寸、字体、颜色 token、row 密度和交互状态；REAR 外层 lane header 不进入 DSH crop。

### 15.4 回归

- `/api/hitch-data` 不携带完整 events。
- canonical endpoint 的 ETag/304、run-id/path 安全校验不退化。
- Provider Evidence、Overview、Breakdown、strict comparison 不受影响。
- `npm run build`、`npm run lint`、现有 run-centered tests 和新增 trajectory tests 全部通过。

## 16. 验收标准

1. canonical lane 中不存在 `.event-card`、事件圆点竖线卡片或“全部 / 动作 / 错误”过滤器。
2. lane 内依次出现 DSH toolbar、`Input / Model / Tools` timeline 和 30px dense ledger。
3. Tool call/result 是同一 row，显示 `args → result`；失败仍是 TOOL role，同时具有 error 状态。
4. Assistant chunks 不单独成行；同一 step 只产生一个 Assistant lifecycle row。
5. Turn、Request marker、折叠 summary、搜索和 timeline focus 直接由 DSH 原生组件提供，并通过 DSH upstream tests 与 REAR bridge tests。
6. 点击 row 在该 lane 内打开可调宽 inspector；不存在 Compare 级共享 drawer。
7. Inspector tabs、字段缺失文案、Markdown/JSON/image 展示与 DSH 基线一致。
8. TTFT 使用 step start 到 first token；无 chunk 时显示 unknown，不显示 `0ms`。
9. 1、2、4 lanes 均可操作；窄 lane 使用 DSH compact role icon 和 lane-local overlay inspector。
10. 长轨迹只挂载 virtual window；搜索、折叠、选中与滚动不因 prepend/refresh 改变 stable identity。
11. DSH reference 与 REAR trajectory surface 的 visual regression 无未批准结构差异。
12. 现有构建、数据完整性、安全和 Provider Evidence 测试全部通过。

## 17. 实施顺序

1. canonical endpoint 返回 raw validated Session events。
2. 确认 DSH trajectory 包作为 REAR client 的强依赖先于 REAR 注册。
3. 用 DSH registry + `ConversationNodeAssembler` 生成离线 snapshot。
4. 从 `conversation.view` slot ledger 解析并渲染原生 `TrajectoryView`。
5. 删除旧 renderer、样式和本地行为测试，补 bridge/integration/visual regression。
