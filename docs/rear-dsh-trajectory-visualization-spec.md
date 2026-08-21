# REAR DSH 轨迹可视化修改 Spec

状态：Proposed  
日期：2026-08-21  
范围：`<REAR_REPOSITORY_ROOT>`，另含一个必须先满足的 Hitch 评测产物导出前置条件

## 1. 背景与基线

Hitch 已把 canonical trajectory 统一为 DSH session JSONL：第一行是 `SessionHeaderLine`，后续每行是一个 `SessionEvent`。每次运行通过 `trajectory.ref.json` 声明格式、fidelity、session 路径和可选 SHA-256。

本 spec 基于以下本地版本：

- DSH 轨迹 UI 参考实现：`deepseek-harness@99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`，核心目录为 `packages/client/ui-trajectory`。
- Hitch canonical trajectory 实现：`agent-hitch@eab418605726bc8ac7db3572e2638e29c551ccc7`，核心目录为 `src/trajectories`。
- Hitch 声明的 DSH 持久化兼容点：`contract_commit = 141eb6fef83422698aef7a981029e843e8161534`、`family = dsh-session`、`version = 0`、`compression = none`、`pack_chunks = false`。
- REAR 当前直接读取 Harbor trial 下的 `agent/hitch-events.jsonl`，把 `message.delta`、`tool.started`、`tool.completed` 等控制/兼容事件压扁成 `TraceEvent[]`，并在 Compare 页面逐卡片展示。

DSH 参考实现的关键不是样式，而是四层分离：

1. 原始 `SessionEvent` 日志。
2. 按事件生命周期折叠出的稳定业务记录，例如 Assistant、Tool、Request。
3. `Turn -> Message/Step -> Record` 布局模型。
4. 共用该布局模型的 ledger、时间轴、搜索、折叠和 inspector。

REAR 应复用这套分层和交互原则，但不直接依赖 `@deepseek-ai/dsh-client-ui-trajectory`。该包依赖 Cordis、DSH client runtime、locale/slot/primitives 等完整浏览器插件栈，不能作为 REAR 的独立 React 组件使用；REAR 只移植与当前产品有关的纯投影逻辑和 UI 行为。

## 2. 目标

将 Compare 页的轨迹区域从 Hitch 旧兼容事件卡片，替换为由 canonical DSH session 投影出的可比较轨迹视图：

- 按 Turn 和 Step 组织 User、System、Assistant、Tool 与 Diagnostic 记录。
- 将 tool call 与 tool result 合成一条有状态、有耗时的 Tool 记录。
- 将 assistant chunk 与最终 message 合成一条 Assistant 记录；只在日志确实提供首 token 时间时展示 TTFT。
- 提供 DSH 风格的三泳道 overview、搜索、Turn/Call 折叠、记录筛选和详情检查器。
- 保留 REAR 的 1–4 条轨迹并排比较、运行摘要、同步滚动和 verifier 结果。
- canonical session 成为新运行的唯一轨迹事实来源；Hitch 控制日志、Harbor 状态和 verifier 不伪装成 DSH 会话事件。

## 3. 非目标

- 不把 DSH 的 Cordis/client runtime 引入 REAR。
- 不在 REAR 中重新实现 Hitch trajectory 生成或修复非法 session。
- P0 不支持编辑、反馈写入、恢复会话、子 agent 树、compaction、nested code-dispatch 或实时未完成 session 流式追踪。
- 不改变 benchmark 聚合、任务选择和 2–4 条轨迹比较流程。
- 不增加 D1、R2 或公开托管能力；REAR 继续是读取本机文件系统的 local-only 工具。
- 不把旧 `hitch-events.jsonl` 转换后冒充 canonical DSH 数据。

## 4. P0 前置条件：导出 Harbor 容器内的 canonical trajectory

这是实现 REAR 修改前必须解决的数据可达性问题。

当前 `integrations/harbor/hitch_harbor_agent.py` 使用 `HITCH_ROOT=/tmp/hitch-state`。运行结束后，它只把以下文件写入 `/logs/agent`：

- `hitch-events.jsonl`
- `hitch-result.json`
- `hitch-stderr.log`

canonical `trajectory.ref.json` 和 `trajectory/.../session.jsonl` 仍位于临时 Harbor 容器的 `/tmp/hitch-state/runs/<run_id>/`，容器删除后宿主机 REAR 无法读取。`hitch-result.json.trajectory.path` 即使存在也是容器绝对路径，不能作为宿主机路径使用。

Hitch/Harbor 必须额外导出以下稳定 artifact：

```text
<trial>/agent/
  hitch-result.json
  hitch-trajectory.ref.json
  hitch-trajectory.session.jsonl
```

导出规则：

- `hitch-trajectory.session.jsonl` 必须是 canonical session 的逐字节副本。
- 导出的 ref 保留 `run_id`、`session_id`、`format`、`fidelity` 和 `sha256`，但将 `path` 改写为相对文件名 `hitch-trajectory.session.jsonl`。
- 不修改容器内原始 ref；只改写导出副本的路径。
- `include_logs = ["hitch-*"]` 已能匹配上述命名，不需要增加一套 Harbor artifact 机制。
- 导出失败必须使 trial 明确失败，不能退回旧事件日志并仍宣称 canonical trajectory 可用。

REAR 也支持非 Harbor 的直接 Hitch run：若 `<HITCH_DATA_ROOT>/runs/<run_id>/trajectory.ref.json` 存在，可以直接读取该 ref 指向的 session。

## 5. 输入契约和发现顺序

### 5.1 支持的格式

P0 只接受 Hitch V1 声明的格式：

```ts
interface TrajectoryFormatRef {
  family: "dsh-session";
  version: 0;
  contract_commit: string;
  compression: "none";
  pack_chunks: false;
}
```

初始支持的 `contract_commit` 为 `141eb6fef83422698aef7a981029e843e8161534`。解析器使用显式 supported-contract registry；遇到其他 commit 或 version 时展示“不支持的轨迹版本”，不得按最接近格式猜测。

### 5.2 每个 trial 的发现顺序

1. `<trial>/agent/hitch-trajectory.ref.json`。
2. 若 ref 不存在且 trial metadata 有 `hitch_run_id`，尝试 `<HITCH_DATA_ROOT>/runs/<hitch_run_id>/trajectory.ref.json`。
3. 若两者都不存在但有 `hitch-events.jsonl`，标记为 `legacy`，在 UI 中提供明确标识的旧日志只读 fallback。
4. 若 canonical ref 存在但无效、hash 不匹配或 session 不可读，标记为 `invalid`；不得静默退回 legacy。
5. 正在运行且尚未生成 ref 时标记为 `pending`。

### 5.3 安全与完整性

reader 必须检查：

- ref schema、format、fidelity 和请求的 `run_id` 一致。
- session 第一行是 version 0 header，`header.id === ref.session_id`。
- event `seq` 从 0 连续递增，`time` 是非负安全整数，`data` 是对象。
- Turn/Step 正确嵌套并闭合；Tool result 只配对同一步内的一个已打开 call。
- ref 有 `sha256` 时，读取内容的摘要必须一致。
- 导出 ref 的相对路径只能解析到该 trial 的 `agent` 目录内；直接 run 的路径只能位于对应 `<HITCH_DATA_ROOT>/runs/<run_id>` 内。
- HTTP API 只接受 REAR run id，不接受任意文件路径。
- canonical 文件是 finalized artifact；截断行或非法 JSON 视为损坏，不能沿用旧 parser“忽略半行”的 live-log 行为。

## 6. 数据架构

### 6.1 Summary API 与 Detail API 分离

`GET /api/hitch-data` 不再返回每个 run 的完整 `events`。它只返回 benchmark、run 摘要和 trajectory descriptor：

```ts
type TrajectoryAvailability =
  | "available"
  | "pending"
  | "legacy"
  | "missing"
  | "invalid"
  | "unsupported";

interface HitchTrajectorySummary {
  availability: TrajectoryAvailability;
  fidelity?: "native" | "normalized" | "minimal";
  contractCommit?: string;
  sessionId?: string;
  eventCount?: number;
  turnCount?: number;
  stepCount?: number;
  toolCalls?: number;
  toolFailures?: number;
  hasErrors?: boolean;
  diagnostic?: string;
}
```

新增 `GET /api/hitch-trajectory?run=<rear-run-id>`，只在用户打开 Compare 时读取选中的 1–4 条轨迹。canonical run 返回投影后的 `TrajectoryDocument`，legacy run 返回独立的 `LegacyTrajectoryDocument`。canonical 响应使用 ref SHA-256 作为 ETag；服务端以 `ref path + mtime + size + sha256` 缓存读取和投影结果。

这样做避免每 10 秒刷新 overview 时，把所有 benchmark 的完整轨迹重复发送到浏览器。

`HitchRun` 新增 `trajectory: HitchTrajectorySummary` 并移除 `events`。为减少 overview/breakdown 组件迁移面，现有 `usage`、`toolCalls`、`toolFailures` 可继续作为 run 级派生字段存在，但必须与 `trajectory` 来自同一次 canonical 投影，不能再读取旧控制日志。

### 6.2 浏览器视图模型

```ts
interface TrajectoryDocument {
  runId: string;
  session: {
    id: string;
    createdAt: number;
    cwd?: string;
    fidelity: "native" | "normalized" | "minimal";
    contractCommit: string;
  };
  summary: HitchTrajectorySummary;
  turns: TrajectoryTurn[];
  unmodeledEvents: RawSessionEvent[];
}

interface TrajectoryTurn {
  turn: number;
  startedAt: number | null;
  completedAt: number | null;
  status: "complete" | "aborted" | "error" | "unknown";
  messages: TrajectoryRecord[];
  steps: TrajectoryStep[];
}

interface TrajectoryStep {
  step: number;
  startedAt: number | null;
  completedAt: number | null;
  records: TrajectoryRecord[];
}

type TrajectoryRecord =
  | SystemRecord
  | UserRecord
  | ContextRecord
  | AssistantRecord
  | ToolRecord
  | DiagnosticRecord;
```

每条 record 必须包含稳定 id、原始 seq/source seq、开始/完成时间、状态、可搜索文本和 inspector 所需的原始块。建议 identity 分别使用 `system:<seq>`、`message:<seq>`、`assistant:<turn>:<step>`、`tool:<callId>`、`diagnostic:<seq>`；不得让 React row key 依赖当前过滤后的数组下标。未生成主 row 的 ignorable event 放入 `unmodeledEvents`，只在 session 级 Raw 面板展示。

legacy detail 使用独立的 `LegacyTrajectoryDocument`/`LegacyTraceEvent` 返回和渲染，不进入 `TrajectoryDocument.turns`，也不复用 DSH timeline、duration 或 token 语义。

### 6.3 canonical summary 的派生规则

- `toolCalls`：`tool/call` 数量。
- `toolFailures`：配对 `tool/result` 中 `isError === true` 或有 `data.error` 的数量。
- usage：对最终 `assistant/message.data.usage` 按 token 字段求和；若 native chunk 只有 usage frame，则在所属 Assistant lifecycle 内累加。
- `hasErrors`：turn error、失败的 tool result 或 error-level `hitch/diagnostic`。
- run verifier/reward 继续来自 Harbor trial，不进入上述统计的事件集合。
- `RunUsage.cost` 若 canonical 轨迹未提供 cost，显示 `—`，不能沿用或推算旧事件日志中的值。

## 7. Event 到 Record 的投影

| Session event | 投影行为 |
| --- | --- |
| `turn/start` | 创建 Turn bucket，保存开始时间。 |
| `user/message` | `source.kind === "user"` 时创建 USER；其他来源创建 CONTEXT/DIAGNOSTIC 风格输入。根据当前 Turn/Step 位置放入 Message 或 Step。 |
| `step/start` | 创建 Step bucket，并作为 Assistant request 的开始时间。 |
| `request/header` | 创建或更新 SYSTEM/REQUEST 记录，保留 provider、model、system prompt 和 tools；空字段保持空，不伪造 catalog。 |
| `assistant/chunk` | 更新当前 `(turn, step)` 的 block 状态、首 token 时间和 usage，不为每个 delta 建 row。 |
| `assistant/message` | 完成一条 ASSISTANT record，保留 text、reasoning、tool-call block、provider/model、usage 与 interrupted 标记。最终 message 内容覆盖同一 lifecycle 的已组装文本。 |
| `tool/call` | 以 `callId` 创建 running TOOL record，记录 name、arguments、turn、step 和开始时间。 |
| `tool/result` | 与同一步的 call 合并，填充 output/error/完成时间；没有匹配 call 的 required result 使轨迹无效。 |
| `step/end` | 冻结未完成但有可见内容的 Assistant；关闭 Step。没有可见内容时不生成空 Assistant row。 |
| `turn/end` | 设置 Turn complete/aborted/error 状态和完成时间。 |
| `hitch/diagnostic` | 创建默认隐藏的 DIAGNOSTIC row；level=error 参与错误筛选和 summary。 |
| 其他 `ignorable: true` | 保存在“原始事件”详情中，默认不生成主 ledger row。 |
| 未识别且非 ignorable | 将轨迹标记为 unsupported/invalid，不猜测语义。 |

Hitch V1 的已知 required event 集合只有 Turn/Step、request、message、tool 等基本类型。DSH 当前 UI 中的 compaction、retry、nested code-dispatch 等能力不应在 P0 中提前实现；等 Hitch contract 明确允许后，再按 discriminant 增量扩展。

### 7.1 时间和 token 语义

- USER、SYSTEM 等瞬时记录的 duration 为 0。
- ASSISTANT start 优先使用 `step/start.time`，end 使用最终 `assistant/message.time`。
- TTFT 只在 `assistant/chunk` 提供首个 token delta 时计算。`normalized`/`minimal` 轨迹通常没有 chunk，UI 显示“未记录”，不能显示 0 ms。
- TOOL duration 为 `tool/result.time - tool/call.time`。
- running/缺失结束时间显示 `—`，不使用当前时间伪造耗时。
- Step/Turn wall time分别来自其显式 start/end boundary。
- timeline 内部使用 epoch ms；界面相对时间以第一条 event 为 `+0`，详情同时可查看本地时间和 Unix timestamp。

## 8. Compare 页面交互

### 8.1 页面结构

保留现有 Compare heading、run summary、PhaseStrip 和 1–4 列网格。将每个 `.trace-lane` 内部替换为 `TrajectoryLane`：

```text
Run header + fidelity/format state
Sticky toolbar
Three-lane overview timeline
Turn/Step ledger
Shared record inspector
```

三泳道沿用 DSH 语义：

1. Input：SYSTEM、USER、CONTEXT、DIAGNOSTIC。
2. Assistant：ASSISTANT。
3. Tool：TOOL。

默认 overview 采用等宽 operation，用户可切换 actual duration。actual duration 下保留真实重叠关系；空闲时间采用压缩显示。P0 不暴露 DSH 当前隐藏的“完整 wall-clock idle gap”开关。

### 8.2 Toolbar

Compare grid 上方提供一组共享 toolbar，统一作用到当前所有 lane：

- Duration 等宽/真实耗时切换。
- 全部 Turn 折叠/展开。
- Assistant 下 Tool call 折叠/展开。
- 搜索；范围包含 summary、assistant text/reasoning、tool name/input/output 和 diagnostic。
- 过滤：全部、Assistant、Tools、Errors。Verifier 不再作为 trajectory filter 项。

搜索和过滤只改变 ledger 可见 row，不改变原始 turn/step 编号、全局 record id、timeline 的基础 domain 或汇总指标。具体折叠集合仍按 run/record id 保存，避免同编号 Turn 在不同 lane 之间互相覆盖。

### 8.3 Ledger

- Turn 用粗分隔线和 sticky header，Step 用紧凑 header。
- 主 row 只展示 `# / Event / Content / Time`，适配 2–4 列窄屏比较。
- token、cache、thinking、完整输入输出和 request options 放到 inspector；单条 run 打开时可在宽屏增加 Input/Output/Think 列。
- Tool call/result 合成一行，running、success、error 使用不同状态；输出不能覆盖输入。
- fidelity 显示在 lane header：`native`、`normalized`、`minimal`。minimal 模式缺少 tool/timing 时显示能力说明，不显示为“0 tools/0 ms”。
- 没有可用 canonical trajectory 时使用明确 empty state：生成中、legacy、缺失、损坏或不支持版本。

### 8.4 Inspector

选择任意 row 后，打开一个跨 compare grid 的共享右侧 drawer，标题包含 run/harness、Turn、Step、record type 和 seq。避免在四条 lane 内分别打开局部 panel 压缩内容。

按 record 类型提供：

- SYSTEM/REQUEST：Summary、Options、System Prompt、Tools、Raw。
- USER/CONTEXT：Rendered、Raw、Source。
- ASSISTANT：Output、Thinking、Source、Usage、Timing、Options。
- TOOL：Input、Output、Error、Schema、Timing、Raw。
- DIAGNOSTIC：Message、Raw。

不存在的数据展示“未记录”，不构造空对象冒充 provider 数据。图片块只允许 `data:image/*`、`blob:`、`http:`、`https:`；其他 scheme 作为文本显示。

### 8.5 Compare 特有行为

- 保留“同步滚动”开关。P0 继续使用每条 ledger 的滚动比例同步；选中记录和 timeline 范围按 lane 独立，toolbar query/filter/action 由 Compare 统一分发。
- 点击 overview span 要选择并滚动到对应 ledger row；拖选时间范围只保留与范围相交的记录；右键清除范围。
- verifier reward、trial exception、environment/agent/verifier phase 仍在 run summary 或独立 banner 中展示，不注入 ledger。
- `buildInsights` 改为读取 `trajectory.summary` 和 run 状态，不再扫描已删除的 `run.events`。

## 9. 性能与状态

- Compare 打开前不加载完整轨迹。
- 最多并发请求当前选中的 4 条轨迹；离开 Compare 时取消未完成请求。
- ledger 使用 `@tanstack/react-virtual`，只挂载可见窗口和小量 overscan；DOM row 数量不随总事件数线性增长。
- row height 以稳定 record id 缓存；assistant 流式内容不是 P0，completed artifact 不需要频繁重测。
- 搜索索引按 record id 构建，并与投影 cache 一起复用。
- completed trajectory 由 hash 标识为 immutable；10 秒 overview 自动刷新不重复读取未变化文件。
- 若保留 system prompt diff，可使用 `diff` 包；不要把 DSH primitives 或完整 UI 包作为依赖引入。

## 10. 文件级改动建议

| 文件/目录 | 修改 |
| --- | --- |
| `lib/hitch-types.ts` | 从 `HitchRun` 删除 `events`；增加 trajectory availability/summary/document 类型。旧 `TraceEvent` 改名为 `LegacyTraceEvent`，只给 legacy detail 使用。 |
| `lib/hitch-scanner.ts` | 停止把 `hitch-events.jsonl` 作为新轨迹事实来源；发现 ref，生成轻量 summary，保留 legacy 检测。 |
| `lib/trajectory/dsh-contract.ts` | Hitch V1 ref/header/event 的最小类型、supported-contract registry 和判别函数。 |
| `lib/trajectory/dsh-reader.ts` | JSONL、hash、路径、seq 和关系不变量校验。 |
| `lib/trajectory/dsh-projector.ts` | Event lifecycle -> `TrajectoryDocument` 的纯函数。 |
| `lib/trajectory/cache.ts` | 以 path/mtime/size/hash 缓存 reader/projector 结果。 |
| `build/hitch-data-plugin.ts` | 从 `vite.config.ts` 提取本地 API；实现 summary 与单-run trajectory endpoint。 |
| `vite.config.ts` | 注册提取后的 local data plugin；不增加 hosted filesystem API。 |
| `app/rear-dashboard.tsx` | 移除 canonical 路径对 `EventCard` 和 `run.events` 的使用；接入新的 `TrajectoryCompare`。 |
| `app/trajectory/*` | Lane、Toolbar、Timeline、Ledger、Turn/Step header、Inspector、loading/error state，以及隔离的 `LegacyEventList`。 |
| `app/trajectory/*.module.css` | 新轨迹 UI 样式；避免继续扩大单一 `globals.css`。 |
| `package.json` | 增加 `@tanstack/react-virtual`；仅在实现 prompt diff 时增加 `diff`。 |
| `tests/fixtures/trajectory/*` | native/normalized/minimal/legacy/invalid JSONL fixtures。 |
| `tests/*` | reader、projector、API、组件与 SSR shell 覆盖。 |

本项目含 `.openai/hosting.json`，但此次仍保持现有 vinext/Sites 构建结构和 local-only 数据读取，不新增 D1/R2 绑定，也不把本机轨迹上传到托管环境。

## 11. 实施顺序

### Phase 0：数据可达性

- Hitch Harbor bridge 导出 ref/session artifact。
- 用一条新 Harbor trial 验证宿主机上 ref、session、hash、run/session id 一致。

### Phase 1：reader 与 summary 迁移

- 增加格式校验、路径约束、投影 cache。
- `HitchRun` 改为 trajectory summary，移除完整 `events` payload。
- 新增按 run 懒加载 endpoint。
- 保留显式 legacy fallback。

### Phase 2：DSH 风格 ledger 与 inspector

- 完成 Turn/Step/Assistant/Tool 生命周期投影。
- 替换 EventCard，接入共享 inspector。
- verifier、trial error 和 phase 保持在会话外。

### Phase 3：overview、搜索与大轨迹性能

- 三泳道 timeline、duration 切换、范围选择。
- Turn/Call 折叠、搜索索引、虚拟列表。
- 补齐 1–4 lane 响应式与键盘操作。

## 12. 测试要求

### Reader/contract

- 正常 normalized、native、minimal ref/session。
- bad header/version/commit、重复或跳号 seq、非法 JSON、hash mismatch。
- 未闭合 Turn/Step、重复 call、跨 Step result、未配对 result。
- ref 路径逃逸 trial/run root。
- canonical 存在但损坏时不回退 legacy。

### Projector

- 多 Turn、多 Step、多个 assistant/tool lifecycle。
- chunk + final message 去重，final message 为权威内容。
- 无 chunk 时 TTFT 为 null。
- tool success/error/interrupted duration 和状态。
- usage 累加、reasoning/cache 字段缺失与存在。
- ignorable event 默认隐藏但 Raw 可见；unknown required 失败。
- verifier 和 Harbor exception 不进入 `TrajectoryDocument.turns`。

### API/cache

- summary 不含完整 record/event 数组。
- detail 只能按已索引 REAR run id 读取。
- ETag/304、文件变化后 cache 失效、4 条请求并发。
- pending、legacy、missing、invalid、unsupported 状态可区分。

### UI

- 1、2、4 lane 均可渲染。
- Search/filter/fold 不改变 record id 和 inspector 目标。
- timeline 点击/拖选能定位和聚焦 ledger。
- keyboard 可操作 toolbar、row、drawer tabs 和关闭按钮。
- 虚拟列表的挂载 row 数量受 viewport/overscan 限制。
- normalized/minimal 缺失 TTFT、schema、cost 时显示“未记录”而不是 0。

## 13. 验收标准

1. 一条新 Harbor eval 完成后，Compare 页面读取 `hitch-trajectory.session.jsonl`，而不是 `hitch-events.jsonl`。
2. UI 的 Turn、Step、Assistant、Tool 数量与 canonical session 一致；Tool input/output 和失败状态能在同一 record 中检查。
3. 运行摘要的 token/tool/error 指标从 canonical session 派生；reward/verifier 仍来自 Harbor。
4. normalized/minimal 缺失的 TTFT、tool schema、cost 等字段不被伪造成 0。
5. canonical hash 或结构校验失败时，lane 明确显示损坏原因且不回退旧日志。
6. `/api/hitch-data` 不再携带所有 run 的完整轨迹；只在打开 Compare 后加载选中 run。
7. 同时比较 4 条长轨迹时，ledger DOM 数量受虚拟窗口限制，搜索、折叠和 inspector 仍可用。
8. 历史 run 只有 `hitch-events.jsonl` 时明确标为 Legacy；新 run 不使用 legacy parser。
9. 本机路径不能通过 API 参数或恶意 ref 逃出所选 Hitch data root。
10. `npm run build`、reader/projector 单元测试、API 测试和现有 SSR shell 测试通过。

## 14. 后续能力

以下能力等 Hitch contract 正式纳入对应事件后再做：

- compaction request/summary/end 展示。
- `llm/retry` request lifecycle。
- `tool/code-dispatch*` nested subtool tree。
- subagent session/lineage 导航。
- finalized artifact 之外的 live incremental trajectory。
- 基于 `(turn, step, record kind)` 的跨 lane 语义对齐，替代滚动比例同步。
