# DSH Refine 迭代工作台插件规格

- 状态：提议
- 日期：2026-08-23
- 目标宿主：DeepSeek Harness Web
- 外部测评事实源：Hitch 以 run 为中心的存储
- 轨迹格式：DSH Session 格式版本 0

## 1. 结论

Refine 迭代工作台是 DSH Web 中由 `/refine` 工作流进入的会话级页面，不是独立应用。用户启动一次 harness refinement 后，应在同一 DSH Session 的 `Refine` 视图中查看候选 harness、测评进度、任务级分数变化和轨迹差异。

该功能以一组可独立装卸的 DSH plugins 交付：Host 侧服务负责 refinement 生命周期及与 Hitch 的只读证据关联，`/refine` command 负责创建 refinement，Client 侧 UI 注册会话 view 和 command card。浏览器不得扫描 Hitch 目录，也不得维护第二份 run、eval 或 trajectory 事实。

```text
DSH Session
  ├─ Chat 视图
  │   └─ /refine 命令卡片 ───────────────────┐
  ├─ Trajectory 视图                         │
  └─ Refine 视图 ◀───────────────────────────┘
      ├─ refinement / iteration 摘要
      ├─ baseline ↔ candidate 对比
      ├─ 测评任务表
      └─ 1–4 个可复用的 DSH 轨迹视图

Host 插件树
  /refine
     │
     ▼
  RefinementRuntime ── 持久化 refinement sidecar
     │
     ├─ RefinementDriver ── 候选生成与迭代编排
     └─ RefinementEvidenceProvider ── Hitch eval/run/trajectory 投影
                                            │
                                            ▼
                              Hitch evals/ + runs/ 事实
```

## 2. 产品边界

### 2.1 用户任务

该页面回答一个核心问题：候选 harness 是否改善了 agent 在所选测评集上的行为，以及为什么？

核心流程如下：

1. 用户在一个 DSH Session 中执行 `/refine`。
2. DSH 创建持久化的 `RefinementRecord`，并启动已配置的 refinement driver。
3. Driver 生成一个或多个候选 harness 修订版本，并通过 Hitch 提交精确测评。
4. 随着测评记录和任务 run 逐步落定，Refine 视图持续更新。
5. 用户打开结果发生变化的任务，对比 baseline 与 candidate 的轨迹。
6. 用户通过所属 refinement 工作流继续迭代、接受结果或结束 refinement。

该页面不是全局 benchmark 浏览器。它可以展示与当前 Session 关联的历史 refinement 记录，但不会从 Hitch 存储中的全部 benchmark 或全部 run 出发组织信息。

### 2.2 数据源归属

| 事实 | 所有者 | Refinement 插件行为 |
| --- | --- | --- |
| Refinement 目标与生命周期 | DSH `RefinementRuntime` | 作为 DSH sidecar 持久化，并通过 Remote 暴露。 |
| Session 与 refinement 的关联 | DSH Session 日志 | 追加一个轻量的 `refinement/created` 事件。 |
| 候选成员关系与迭代顺序 | DSH refinement driver | 通过 `RefinementRuntime` 提交。 |
| 请求的与最终解析的 harness 身份 | Hitch run/eval 记录 | 仅引用和投影，绝不改写。 |
| Benchmark、task、verifier 与 protocol 身份 | Hitch run 记录 | 对比前完成校验。 |
| Reward 与无效 observation | Hitch eval/run 记录 | 按观测事实展示；无效不等于零。 |
| 规范化及 provider 原生轨迹证据 | Hitch `TrajectoryRef V2` | 通过 Host provider 按需加载。 |
| Promotion、rollback 与仓库变更 | 所属 refinement driver | 除非另有规格，否则不属于可观测性 UI。 |

Hitch 始终是证据层和身份层。DSH 负责候选生成、对比意图及面向用户的 refinement 生命周期。

## 3. 目标

1. `/refine` 创建持久化的 refinement 身份，并在不等待测评完成的情况下返回。
2. 当前 DSH Session 提供 Refine 视图，并能在浏览器刷新和重新连接后恢复。
3. 页面默认在相同 model 与测评 protocol 下，对 baseline 和当前 candidate harness 做严格对比。
4. 当 harness 身份固定时，用户可以切换到 model 对比。
5. 每个任务行展示全部 attempt、observation 有效性、reward 差值以及执行/完整性失败。
6. 用户可以对比属于同一 task 身份的一至四条轨迹。
7. 每个 lane 复用 DSH 自身的轨迹投影、时间线、ledger 和 inspector，而不是复制一套实现。
8. 实时更新由事件驱动；重新连接后执行权威数据重同步。
9. 卸载插件时注销命令、Remote 方法、事件订阅与 UI 入口，并且不遗留仍在进程内运行的工作。

## 4. 非目标

- 独立的 REAR 服务、品牌、导航栏、部署方式或数据根目录。
- 覆盖无关 Hitch benchmark 的通用仪表盘。
- 定义修改 harness 或选择下一候选版本的算法。
- 定义 benchmark 设计、verifier 策略、候选 promotion 或 rollback 语义。
- 将 Hitch run 事实复制到 DSH 存储，并把副本作为替代事实源。
- 读取 Harbor staging bundle 或旧版 `hitch-events.jsonl` 文件。
- 把 task 身份不同的 run 当作严格对比对象。
- 仅为该功能引入应用级 URL router。
- 将本地测评或轨迹证据上传到远程服务。

## 5. 插件拓扑

该功能以插件族交付，而不是把 Host 存储、编排、传输和 React 代码塞进同一个包。

| 包 | 职责 | 依赖服务 |
| --- | --- | --- |
| `@deepseek-ai/dsh-refinement` | Service Definition 与协调器；负责记录、provider registry、持久化、Remote 读取与变更通知。 | `storageDomain`、`sessions` |
| `@deepseek-ai/dsh-command-refine` | 面向用户的 `/refine` 命令 Consumer。 | `commands`、`refinements` |
| 已配置的 refinement-driver 包 | Service Provider；把现有 harness 迭代工作流适配为 `RefinementDriver`。候选生成算法与包名仍归该工作流所有。 | `refinements` 及其编排依赖 |
| `@deepseek-ai/dsh-refinement-hitch` | Hitch 证据 Service Provider；从已配置的 Hitch 安装中解析 eval、run 与轨迹字节。 | `refinements` 及已配置的 Hitch transport |
| `@deepseek-ai/dsh-client-ui-refinement` | Web Consumer；提供 Refine 视图、富命令卡片和每 Session 一个的 controller。 | `slots`、`sessions`、`remote.refinements`、`conversationViews`、`locale`、`layout` |
| `@deepseek-ai/dsh-client-ui-trajectory` | 现有可复用轨迹渲染器。 | 保留现有依赖；新增供 `ui-refinement` 使用、可安全运行于 Client 的纯导出。 |

目标 Web 组合必须先挂载 Host refinement 服务，再挂载命令、已配置的 driver 和 Hitch provider；`ui-refinement` 则在 `ui-conversation`、`ui-commands` 与 `ui-trajectory` 之后挂载。Profile 可以通过删除这些配置行移除整个功能。

该服务以可逆 effect 接受 driver 与 evidence provider 注册。重复 provider id 必须在注册时失败。已配置的 provider id 缺失或不可用时，操作必须在解析 provider 阶段失败；runtime 不得自动选择第一个已注册的 provider。

Host 服务配置必须显式提供 `driver`、`evidenceProvider`、`objectiveMaxBytes`、`trajectoryResponseMaxBytes` 和 `providerEvidencePageMaxBytes`。Web bundle 在 `cordis.patch.yml` 中提供产品策略；操作内部不得隐藏兜底限制。

## 6. 领域模型

### 6.1 身份标识

所有跨包身份在实现中都必须是不透明的 branded 类型：

```ts
type RefinementId = Branded<'RefinementId'>
type RefinementIterationId = Branded<'RefinementIterationId'>
type RefinementCandidateId = Branded<'RefinementCandidateId'>
type HitchEvalId = Branded<'HitchEvalId'>
type HitchRunId = Branded<'HitchRunId'>
```

`RefinementId` 由 DSH 在后台工作开始前生成。Hitch eval id 与 run id 只能从已配置的 evidence provider 接收，绝不能根据路径推断。

### 6.2 Session 归属

一个 refinement 归属于某个精确且已持久化的 Session 生命周期，而不是仅归属于可复用的 `SessionId` 字符串：

```ts
interface RefinementSessionIdentity {
  readonly sessionId: SessionId
  readonly createdAt: number
  readonly cwd?: string
}
```

List、get、cancel 与 mutation 操作都必须校验该生命周期身份。复用 Session id 后，旧生命周期留下的 sidecar 不得对新 Session 可见。

### 6.3 持久化 refinement 记录

```ts
type RefinementStatus =
  | 'queued'
  | 'running'
  | 'awaiting-review'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface RefinementRecordV1 {
  readonly schemaVersion: 1
  readonly id: RefinementId
  readonly session: RefinementSessionIdentity
  readonly objective: string | null
  readonly driver: {
    readonly id: string
    readonly operationId: string | null
  }
  readonly evidenceProviderId: string
  readonly status: RefinementStatus
  readonly baselineCandidateId: RefinementCandidateId | null
  readonly activeIterationId: RefinementIterationId | null
  readonly candidates: readonly RefinementCandidateRecord[]
  readonly iterations: readonly RefinementIterationRecord[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt?: number
  readonly failure?: RefinementFailure
  readonly version: string
}
```

`version` 是仅用于相等性比较的 token，每次实质性更新提交后都会替换。Remote mutation 用它执行 compare-and-set。Driver id 与 evidence provider id 在准入时固定，因此重启后绝不会通过新选择的 provider 重新解释已有 refinement。`driver.operationId` 是由该 driver 所有、用于相等性判断和重新附着的不透明 token。时间戳由 Host 分配，使用 Unix epoch 毫秒，且绝不倒退。

### 6.4 候选与迭代记录

```ts
interface RefinementIterationRecord {
  readonly id: RefinementIterationId
  readonly ordinal: number
  readonly status: 'preparing' | 'evaluating' | 'settled' | 'failed' | 'cancelled'
  readonly candidateIds: readonly RefinementCandidateId[]
  readonly evaluationRefs: readonly RefinementEvaluationRef[]
  readonly createdAt: number
  readonly completedAt?: number
  readonly failure?: RefinementFailure
}

interface RefinementCandidateRecord {
  readonly id: RefinementCandidateId
  readonly role: 'baseline' | 'candidate'
  readonly parentCandidateId: RefinementCandidateId | null
  readonly requestedHarnessRef: string
  readonly revisionIdentity: string | null
  readonly label: string
  readonly createdAt: number
}

interface RefinementEvaluationRef {
  readonly providerId: string
  readonly evalId: HitchEvalId
  readonly candidateId: RefinementCandidateId
  readonly requestedModelId: string
  readonly benchmarkId: string
  readonly benchmarkRevision: string
}
```

Candidate 记录保留 refinement 谱系和请求时的引用。用于得出结论的最终 harness、model、protocol 与 task 身份始终来自 Hitch run 记录。

一次 iteration 可以包含两个以上的 candidate 和多个 model。UI 从这些 observation 中选择严格可比的配对或分组；存储层不得固化 A/B 两组假设。

### 6.5 失败

业务失败使用稳定代码和结构化标识。至少包括：

- `refinement-not-found`
- `session-lifecycle-mismatch`
- `driver-unavailable`
- `evidence-provider-unavailable`
- `evaluation-not-found`
- `run-not-found`
- `trajectory-not-found`
- `trajectory-corrupt`
- `version-conflict`
- `already-terminal`
- `cancel-unavailable`

Transport、parser 与文件系统失败在 Remote 载体中保持为基础设施失败。UI 不得把它们转换成 reward 为零或空的成功测评等业务状态。

## 7. `RefinementRuntime`

### 7.1 职责

`RefinementRuntime` 负责：

- `ctx.refinements` 服务；
- 一张以 `RefinementId` 为键的 storage-domain 表，以及一个 Session 索引；
- driver 与 evidence provider registry；
- 按 refinement 串行化 mutation；
- 不可变的 Remote snapshot；
- 在每次更新提交或所引用证据变化后发送 `refinement/change` 失效通知；
- 对非终态记录进行重启恢复。

它不解释 reward、不为 candidate 排名、不修改仓库，也不把规范化 Session 事件解析成 React model。

### 7.2 Provider 接口契约

两类 provider 暴露以下逻辑操作；精确的 readonly 请求/结果联合类型定义在各自所属的 `types.ts` 模块中：

```ts
interface RefinementDriver {
  readonly id: string
  available(): boolean
  run(operation: RefinementDriverOperation): Promise<void>
  resume(operation: RefinementDriverOperation): Promise<void>
  cancel(request: RefinementDriverCancelRequest): Promise<RefinementDriverCancelResult>
}

interface RefinementEvidenceProvider {
  readonly id: string
  available(): boolean
  evaluation(ref: RefinementEvaluationRef): Promise<RefinementEvaluationView>
  compare(request: RefinementComparisonRequest): Promise<StrictComparisonResult>
  trajectory(request: RefinementTrajectoryLookup): Promise<CanonicalTrajectoryDocument>
  providerEvidence(request: RefinementProviderEvidenceLookup): Promise<ProviderEvidencePage>
  watch(ref: RefinementEvaluationRef, onChange: () => void): () => void
}
```

`RefinementDriverOperation` 携带准入时精确的所属 Session/Agent 启动上下文、由服务所有的取消 signal，以及一组 capability callback，用于记录不透明的 driver operation id、添加 candidate、开始/结束 iteration、关联 evaluation 和结束 refinement。Driver 不会获得 storage table，也不能自行发布 `refinement/change`。

`resume` 接收持久化记录，但不接收可能过期的在线 `Agent` handle。它必须通过已记录的外部 id 重新附着，否则将 refinement 结束为失败。`cancel` 必须幂等，并返回外部工作是已确认停止、仍在外部运行，还是此前已处于终态。

Evidence provider 在读取证据前，必须验证每个请求的 eval 都属于该 refinement，且每个请求的 run 都属于该 eval。其结果对象必须是脱离内部状态的不可变 snapshot。`watch` 监听 provider 的机器事件流，或能感知完整性的文件通知；返回的 disposer 用于移除监听。通知可以合并，但不得依赖 React 轮询。

### 7.3 启动契约

`start(agent, request)` 按以下顺序提交：

1. 解析并校验已配置的 driver 与 evidence provider。
2. 在写入状态前，规范化 objective 和由 provider 所有的启动规格。
3. 在精确的 Session 生命周期下持久化一条新的 `queued` 记录。
4. 向该 Session 追加 `refinement/created`。
5. 仅在两次持久化写入均成功后调度 driver 执行。
6. 返回 refinement id 与源事件序号。

如果追加 Session 事件失败，服务必须在任何 driver 工作开始前删除新建的 sidecar。准入后 driver 失败会把记录改为 `failed`；不得追溯性地把已接受的 `/refine` 命令变成未知命令。

命令请求的 `AbortSignal` 仅在持久化准入完成前生效。准入后浏览器断开连接不会取消 refinement。

### 7.4 后台生命周期

Driver 通过 `RefinementRuntime` 提供、作用域限定于本次 operation 的 callback 提交 candidate 与 evaluation 引用。Driver 绝不直接修改 storage table。

每次更新都必须通过所属 refinement 的串行化队列准入。携带旧 `version` 的过期 callback 必须被拒绝，不能覆盖较新的状态。除非创建新的 refinement，否则终态记录拒绝新增 iteration。

提交 evaluation ref 后，runtime 必须为它附着且仅附着一个 evidence-provider watch。Provider 通知生成新的 `changeToken` 并发出 `refinement/change`，但不把变化后的 Hitch 事实复制到 refinement 行。终态 evaluation 的 watch 可以在最后一次权威读取后移除；重新连接或 Host 重启时，根据持久化 ref 重建必要的 watch。

Host 重启时，runtime 对每条非终态记录调用已选 driver 的恢复操作。由 provider 支持的 Hitch eval 可以在 DSH 进程外继续运行；恢复时必须重新附着到精确的 `evalId`。如果 provider 无法重新附着，则应以持久化失败信息把记录结束为 `failed`，而不是静默重启工作。

插件卸载时停止接收 mutation，等待已准入的存储 transaction 完成，移除订阅，并要求每个进程内 driver operation 停止。它不会隐式取消外部持久运行的 Hitch eval；用户显式取消时，必须使用精确 id 调用 provider。

### 7.5 远程 API

该服务在 `refinements` namespace 下扩展 `TypertRemoteService`。P0 暴露：

```ts
interface RefinementRemote {
  list(request: RefinementListRequest): Promise<RefinementListResult>
  get(request: RefinementGetRequest): Promise<RefinementGetResult>
  cancel(request: RefinementCancelRequest): Promise<RefinementCancelResult>
  evaluation(request: RefinementEvaluationRequest): Promise<RefinementEvaluationResult>
  trajectory(request: RefinementTrajectoryRequest): Promise<RefinementTrajectoryResult>
  providerEvidence(request: RefinementProviderEvidenceRequest): Promise<RefinementProviderEvidenceResult>
}
```

`list` 返回指定 Session 的轻量记录。`get` 返回一个 refinement 及其 iteration 和 candidate。`evaluation` 连接所引用的 Hitch eval 与 run 摘要。完整规范化事件只能由 `trajectory` 针对单个已选 run 返回。Provider evidence 必须按 cursor 分页并受字节数限制。

每个请求都携带 `sessionId`；Host 解析当前持久化的 Session 生命周期，并验证所请求 refinement 归属于它。若提供另一个 Session 中的有效 refinement id，必须返回 `refinement-not-found`，不得泄露它是否存在。

无 scope 的单向 Host 事件 `refinement/change(sessionId, refinementId, changeToken)` 必须加入 API Remote 的转发事件 allowlist。`changeToken` 是仅用于相等性比较的失效 token，在 refinement 记录提交和 provider 证据通知时都会生成；它不同于 `RefinementRecord.version`，且不携带证据 payload。已加载目标 Session 的 Client 调用 `get` 或 `evaluation` 重新同步。由于转发事件不是持久队列，重新连接时也要执行完整重同步。

### 7.6 快照边界

- `list` 不包含规范化事件、provider 原生证据或 verifier blob。
- `get` 不包含 task 轨迹内容。
- `evaluation` 可以返回 task/run 摘要，但不得返回不受限的原始后端日志。
- `trajectory` 返回一份经过校验的规范化 Session 文档，并拒绝超过已配置响应字节限制的文件。
- `providerEvidence` 在编码结果和 wrapper metadata 均已知后执行限制。

这些限制是必需的插件配置，并在加载时校验。缺失限制时，操作不得静默选择内置常量。

## 8. Hitch 证据提供器

### 8.1 提供器边界

`@deepseek-ai/dsh-refinement-hitch` 是唯一了解 Hitch transport 配置或存储路径的组件。浏览器与 `ui-refinement` 只依赖 `RefinementRemote` 的值。

Provider 必须使用 Hitch 已文档化的机器接口，可以选择经过认证的 daemon API 或稳定的 programmatic API。禁止导入未公开的 `dist/src/*` 文件，也禁止解析面向人的 CLI 输出。只有在调用 `--json`、校验声明的 schema version 并保留类型化 failure code 时，CLI adapter 才可接受。

### 8.2 读取规则

Provider 遵循 [REAR 对 Hitch Run-Centered Storage 的适配 Spec](rear-run-centered-storage-adaptation-spec.md) 中定义的以 run 为中心的规则：

- eval trial 通过 `result.trials[*].run_id` 引用 run；
- run manifest、result、verifier output 与 `TrajectoryRef V2` 是权威事实；
- `indexes/runs.v1.json` 可以加速发现，但不是事实源；
- 不读取 Harbor staging bundle 和旧版 trial log；
- 每个相对证据路径都必须位于目标 run 目录内；
- 内容通过 Remote API 前，必须校验文件大小与 SHA-256。

### 8.3 测评投影

Provider 返回 task 身份、每次 attempt、执行状态、observation 状态、reward、harness/model/protocol 身份、完整性诊断、轨迹可用性与轻量轨迹摘要。

如果一个 eval 编排成功但所有 trial 都无效，它仍然是成功的 eval，只是没有有效分数。轨迹缺失、损坏和不受支持必须保持为互不混淆的可用性状态。

Provider 可以按 digest 缓存解析后的不可变终态记录。它必须刷新 queued/running eval；如果被引用文件的身份意外变化，则必须使对应的缓存投影失效。

## 9. Session 事件与 `/refine`

### 9.1 持久化关联事件

Host 包为 `SessionEventMap` 增加一个对 model 不可见的事件：

```ts
interface SessionEventMap {
  'refinement/created': {
    refinementId: RefinementId
  }
}
```

该事件用于重建 Session 与 refinement 的关系，并渲染富命令卡片。Task 进度、reward 与轨迹仍保留在 sidecar/Hitch 存储中，不重复写入 Session 日志。

### 9.2 命令行为

`@deepseek-ai/dsh-command-refine` 注册全局命令：

```text
/refine [objective]
```

可选 objective 去除首尾空白后保存在 refinement sidecar 中，并受已配置的 UTF-8 字节限制约束。空 objective 表示“使用已配置 refinement driver 的默认目标”；命令插件不得自行编造目标。命令注册设置 `recordInput: false`，因为 sidecar 是 objective 的权威来源，Session 事件仅携带 refinement id。

成功时，命令结果通过 `sourceEventSeq` 标识对应的 `refinement/created` 序号，并返回简短确认信息。它不在命令文本中流式输出进度，也不等待第一次 evaluation。

如果准入前无法解析 driver 或 evidence provider，命令返回错误，且不追加 `refinement/created` 事件。之后发生的 driver/evaluation 失败则展示在 refinement 记录与卡片中。

P0 中的取消操作由 Refine 视图负责。未来的 `/refine cancel` 子命令可以调用同一个 Remote/service 操作，但不得引入第二套取消实现。

## 10. 客户端插件

### 10.1 扩展项

`@deepseek-ai/dsh-client-ui-refinement` 提供：

1. 一个 id 为 `refinement`、标签为 `Refine` 的 `conversation.view` 入口。
2. 一个 `refinement-links` conversation projection：把每个 `refinement/created` 事件序号映射到对应 refinement id，但不创建可见的 Chat 行。
3. 一个键为 `refine` 的 `conversation.chat.commandview` renderer：通过 `refinement-links` 解析 `command/done.sourceEventSeq`，展示 controller 中的 objective/status，并提供“打开 Refine”操作。
4. 每个 Session 一个 `RefinementController`，由命令卡片与 Refine 视图共享。
5. 中文与英文 locale dictionary。

只要插件已安装，P0 就始终显示 Refine tab。没有 refinement 的 Session 展示包含 `/refine` 指引的紧凑空状态。该功能不要求 `ui-conversation` 新增条件式 view 注册能力。

`ui-conversation` 在 `CommandRowOwnerProps` 上新增通用的 `openView(viewId)` callback；Chat 视图使用现有的每 Session `setView` store action 实现它。该 callback 不专属于 refinement，而是任意富命令行跳转至已注册 conversation view 的受支持方式。

命令卡片的打开操作先在 controller 中选中目标 refinement，再调用 `openView('refinement')`。直接打开该视图时，默认选中与该 Session 关联的最新 refinement；如果 controller 已有有效选择，则保留该选择。

### 10.2 控制器状态

```ts
interface RefinementViewState {
  readonly status: 'cold' | 'loading' | 'ready' | 'error'
  readonly selectedRefinementId: RefinementId | null
  readonly selectedIterationId: RefinementIterationId | null
  readonly comparisonDimension: 'harness' | 'model'
  readonly referenceRunId: HitchRunId | null
  readonly selectedTaskKey: string | null
  readonly selectedRunIds: readonly HitchRunId[]
  readonly records: readonly RefinementSummary[]
  readonly detail: RefinementDetail | null
  readonly evaluation: RefinementEvaluationView | null
  readonly error: string | null
}
```

Controller 负责 Remote 读取、事件失效、重连重同步、请求取消与对比选择状态。React component 只渲染 snapshot 并调用 controller action；不得调用 `fetch`、读取文件或拼装 URL。

收到 `refinement/change` 时，只把匹配且已加载的 refinement 标记为过期，并把重复事件合并成一次刷新。Record 响应携带 `version`；evaluation 响应携带由 provider 推导的 `evidenceVersion`。旧响应绝不能替换同类的较新 snapshot。

### 10.3 页面层级

Refine 视图在同一个 conversation view 内包含三层：

```text
Refinement 总览
  └─ 迭代测评
       └─ 任务轨迹对比
```

页面的返回控件仅在该局部层级中向上移动，不改变当前 DSH Session。切换到 Chat 或 Trajectory 后，仍保留该 Session 的 Refine controller 选择状态。

## 11. 页面行为

### 11.1 Refinement 总览

总览展示：

- objective 与生命周期状态；
- baseline harness 身份；
- 当前 iteration 与 candidate 谱系；
- 来自所引用 eval 的精确 benchmark id/revision 与 model 选择；
- 以已落定 task 数/计划 task 数表示的 evaluation 进度；
- 有效 observation 的分数摘要；
- invalid、failed、timed-out 与 corrupt 数量；
- 每个 iteration 进入其 evaluation 视图的入口。

未知值必须展示为未知。UI 绝不能把缺失的 duration、token 数、reward 或 cost 显示为 `0`。

### 11.2 迭代测评

默认对比为当前 candidate 与相同 effective model 下最近一次已测评的 baseline。如果不存在严格可比的配对，页面以探索模式打开，并明确列出不兼容原因。

主表以 task 为第一维度：

| 任务 | 基线 | 候选 | 差值 | 状态 | 操作 |
| --- | --- | --- | --- | --- | --- |
| 精确 task 身份 | reward/invalid | reward/invalid | 仅双方有效时显示数值 | improved/regressed/unchanged/invalid/pending | 对比轨迹 |

多次 attempt 必须在 task 单元格中保持可见。表格不得通过求平均掩盖无效 attempt，也不得仅因某次 attempt 得分最高就选择它。

对每个 candidate/task 单元格，分数是所有有效且完整性合格 observation 的均值。只有双方均值都存在时，差值才是 `candidate mean - baseline mean`。正差值表示 improved，负差值表示 regressed，精确为零表示 unchanged；已处于终态但没有有效均值的单元格为 invalid，尚未落定的单元格为 pending。无效 attempt 必须与聚合值一起保持可见。

默认排序为：regression、invalid/基础设施失败、improvement、unchanged、pending。筛选器可以选择这些状态，但筛选绝不能改变聚合结果或对比有效性。

### 11.3 轨迹对比

打开 task 时，预选 baseline 与当前 candidate 在双方共有且具有规范化或 provider 证据的最小 attempt ordinal 对应 run。如果没有任一共有 ordinal 具备证据，则分别选择各 candidate 有证据的最小 attempt，并把 lane 标记为未配对 attempt。选择绝不偏好 reward 最高的 attempt。用户可以选择一至四个 run，但所有已选 run 必须具有完全相同的 task key。

对比页头为每个 lane 展示：

- candidate/harness 身份；
- effective model 身份；
- execution 与 observation 状态；
- reward；
- 可用时展示 agent duration 与已记录 phase；
- 可用时展示 tool 数、usage 与 TTFT；
- eval/trial/attempt 与 protocol 身份。

规范化轨迹是默认视图。Provider Evidence 保持为明确的次级视图，并标注为原始/原生证据；规范化 ledger 绝不能标注为 provider 原生。

每个 lane 独立拥有 timeline 缩放、焦点、搜索、行选择与 inspector 状态。Actual-duration 偏好可以是浏览器级，行为与现有 DSH trajectory 保持一致。同步垂直滚动是可选的对比级控件，按相对滚动进度工作；它不会合并 lane 状态。

一个 lane 使用全部可用宽度。二至四个 lane 使用可水平滚动的网格，并设置足以容纳轨迹 ledger 的最小 lane 宽度。进入对比时，通过 `ctx.layout.closeDetails()` 关闭无关的 DSH details 栏；不得强制折叠 sidebar，也不得覆盖用户的宽度偏好。

## 12. 严格对比

对比资格由 Host 生成，Client 只负责展示。严格的 harness 对比要求：

- 两个 run 都是 `benchmark_task` run；
- benchmark id、benchmark revision 与 task id 一致；
- task digest 与 verifier 身份一致；
- 完整的 protocol 身份一致；
- effective model 身份一致且已解析；
- harness 身份均已解析，且至少包含两个不同值；
- 聚合使用的每个 metric observation 均有效且完整性合格。

严格的 model 对比适用相同规则，但固定完整 harness 身份，并要求至少存在两个不同且已解析的 effective model 身份。

Run 执行失败与无效 observation 保持可见，但不计入 reward 均值。身份或 protocol 不匹配时，生成带稳定 exclusion code 的探索性对比。探索模式可以展示轨迹和原始差值，但不得声称某个 harness 或 model 更好。

身份校验、资格、排除项与聚合归 Hitch 机器对比 API 所有；Hitch evidence provider 通过 `RefinementRemote` 返回其结果。如果所需操作尚未公开，必须先在 Hitch 中增加该能力再做集成。`lib/hitch/strict-comparison.ts` 中经过测试的逻辑是迁移依据，不得复制到 DSH 或浏览器中。

## 13. 复用 `ui-trajectory`

`ui-refinement` 不得复制 `ui-trajectory` 中的文件。现有包应重构为一个深层模块，供两类 consumer 使用：

```text
ui-trajectory
  ├─ Session adapter
  │   └─ 当前 Session useSession(...) → TrajectorySnapshot
  ├─ 离线规范化 adapter
  │   └─ Session header + validated events → TrajectorySnapshot
  └─ TrajectorySurface
      └─ toolbar + timeline + ledger + lane 内 inspector
```

该包导出可安全运行于 Client 的纯契约与组件，其能力等价于：

```ts
interface TrajectorySurfaceProps {
  readonly snapshot: TrajectorySnapshot
  readonly history: 'complete' | 'paged'
  readonly actualDuration: boolean
  readonly onActualDurationChange: (value: boolean) => void
  readonly onScrollElement?: (element: HTMLElement | null) => void
}

function buildOfflineTrajectorySnapshot(
  header: SessionHeader,
  events: readonly SessionEvent[],
): TrajectorySnapshot
```

Session adapter 保留历史加载、实时 partial output 与运行中 call。离线 adapter 把已完成的 Hitch artifact 视为完整历史，保持 `partial: null`，同时仍投影已记录的不完整/错误生命周期，且不虚构基于当前时间的 duration。

所需投影与视觉行为仍由 [REAR 轨迹展示 1:1 对齐 DSH Spec](rear-dsh-trajectory-visualization-spec.md) 定义。一旦 DSH 的可复用导出就绪，该文档即转为迁移依据，不再作为独立的 UI 实现契约。

## 14. 持久化与一致性

DSH refinement sidecar 只存储归 refinement 所有的事实和外部 id，不嵌入 Hitch run manifest、eval result 或轨迹事件。

Storage-domain 的逻辑布局如下：

```text
refinement domain v1
  refinements[refinementId] -> RefinementRecordV1
  sessions[SessionId]       -> 精确 Session 生命周期 + 有序 refinement id
```

当后端支持时，同时修改记录与其 Session 索引的更新必须作为一个 storage-domain transaction 提交。如果当前 storage API 无法跨两张表执行 transaction，则 domain 在每个 refinement 行内存储 Session 身份，并把索引视为可重建的派生状态。

Hitch 终态记录是不可变证据。如果同一 id 下的终态记录发生变化，provider 必须报告完整性损坏，不得像普通更新一样把 UI 刷新为新内容。

## 15. 安全与隐私

- 浏览器不会收到文件系统根目录或证据路径。
- Host 请求在查找 provider 前校验不透明 id。
- Refinement 不能查询未被其任一 evaluation 记录引用的 run。
- Hitch 相对路径必须解析到精确的 run 目录之下，并拒绝通过符号链接逃逸。
- 返回轨迹或 provider evidence 前必须校验 SHA-256 和字节数。
- Provider evidence 必须分页、限制响应大小，并以无执行能力的纯文本或显式二进制数据渲染；绝不能作为 HTML 注入。
- 展示 Hitch 已有的脱敏 metadata，插件不得静默执行“反脱敏”。
- Web transport trust、认证与 host allowlist 继续由现有 DSH 连接和 API gateway 负责。

## 16. 失败与空状态

| 条件 | UI 行为 |
| --- | --- |
| Session 中没有 refinement | 展示 `/refine` 空状态。 |
| Driver 在准入前不可用 | 命令报错；不创建 refinement 记录。 |
| Driver 在准入后失败 | 保留持久化的失败 refinement，并展示 failure code/message。 |
| Hitch provider 不可用 | 保留 refinement metadata；展示证据不可用并允许重试。 |
| Eval 运行中且尚未导入 run | 展示 eval 进度/pending task；不得虚构 run。 |
| Eval 已终止但缺少 run 关联 | 展示 corrupt 诊断；从 metric 中排除。 |
| 缺少规范化轨迹 | 仅在 Provider Evidence 存在时提供该入口。 |
| 轨迹 checksum/schema 校验失败 | 展示 corrupt/unsupported 状态；绝不根据部分数据猜测记录。 |
| Remote 重新连接 | 保留上一份 snapshot 并标记过期，随后重新同步。 |
| 已选 run 从刷新后的非终态 eval 中消失 | 从选择中移除，并显示诊断信息。 |

## 17. 验证

### 17.1 宿主端包

- 单元测试覆盖记录校验、Session 生命周期隔离、provider 选择、按 refinement 串行化、版本冲突与终态拒绝。
- 存储测试证明重启恢复、索引重建，以及 mutation 仅在提交后发布。
- 命令测试证明 `/refine` 记录 `command/run`/`command/done`，恰好追加一个 `refinement/created`，在 driver 完成前返回，并且准入校验失败时不留下 created 事件。
- Hitch provider 测试使用以 run 为中心的 fixture，覆盖 valid、invalid、running、corrupt-link、missing-trajectory、provider-only 与规范化轨迹。
- 不变量检查证明每条非终态记录都有精确的 Session 所有者，且每个被引用的 eval/candidate 都属于同一个 refinement。

### 17.2 客户端包

- Controller 测试覆盖冷启动、合并 change 事件、重连重同步、拒绝过期响应、请求中止与 Session 间隔离。
- Component 测试覆盖 empty、running、failed、strict、exploratory 以及一至四个 lane 的状态。
- Presentation 测试固定 task 选择、无效 observation，以及 Host 提供的每一种身份不匹配原因的渲染。
- `ui-trajectory` 测试让同一份规范化 fixture 分别通过 Session adapter 与离线 adapter，并断言 ledger/request/timeline 投影等价。

### 17.3 真实 Web 组合

一个无需密钥、按真实配置装配的 Web fixture 必须验证完整路径：

1. 在真实 Session 中提交 `/refine`。
2. 看到富命令卡片，并打开 Refine 视图。
3. 通过真实 Loader 组合注入确定性的 fake driver 与 Hitch evidence provider。
4. 无需刷新浏览器即可看到进度变化。
5. 打开一个 regressed task，并渲染 baseline/candidate 轨迹 lane。
6. 重新加载浏览器，并从 Host 持久化状态恢复同一个 refinement。

该 fixture 不依赖 Harbor、Docker、凭据或网络访问。真实 Hitch/Harbor 集成仍作为单独的可选 integration test。

## 18. 从 REAR 迁移

当前仓库是行为原型与迁移来源。迁移按职责归属进行，而不是把整个应用嵌入 DSH：

| 当前来源 | 目标所有者 |
| --- | --- |
| `app/trajectory/*` | 由 DSH `ui-trajectory` 的可复用导出替代。 |
| `lib/hitch/strict-comparison.ts` | 迁入 Hitch 机器对比 API；DSH 只消费结果。 |
| `lib/hitch/{run-record,eval-record,trajectory-ref}.ts` | 迁入 Hitch evidence provider，优先通过稳定的 Hitch 机器 API 获取。 |
| `lib/hitch-scanner.ts` | 从浏览器功能中移除；发现职责归 provider 所有。 |
| `app/rear-dashboard.tsx` 的 overview/breakdown/compare 状态 | 拆分到 `RefinementController` 与 `ui-refinement` 视图。 |
| `/api/hitch-data` 与 `/api/hitch-trajectory` | 由生成的 `refinements` Remote 方法替代。 |
| REAR shell、metadata 与本地 data-root 配置 | DSH Web 达到行为一致后移除。 |

迁移必须先落地可复用的 `ui-trajectory` 组件，再落地 Host Remote/provider，最后落地 Refine 视图与 `/refine` 卡片。独立 shell 只保留到 DSH 装配 fixture 与轨迹一致性测试通过为止。

## 19. 验收标准

1. 成功执行 `/refine` 后，创建一个与当前精确 Session 生命周期关联的持久化 refinement，并在 evaluation 完成前返回。
2. 命令卡片能在不离开 DSH Web 的情况下打开 `Refine` conversation view。
3. 浏览器重新加载后，能从 Host 所有的状态中重建 refinement、其当前选中的 iteration 及全部已落定的 evaluation 摘要。
4. 运行中的 evaluation 更新通过 `refinement/change` 加权威重同步呈现，React 不轮询文件系统。
5. 存在严格可比配对时，当前 iteration 默认对比 baseline 与当前 candidate harness。
6. Strict/exploratory 状态及排除原因与 Host 对比结果一致；Client 代码不能自行把探索性对比升级为严格对比。
7. 一次 task 对比最多接受四个 run，并拒绝选择 task 身份不同的 run。
8. 规范化 lane 通过 DSH `TrajectorySurface` 渲染；目标实现中不保留复制的 REAR 轨迹组件。
9. 缺失值保持为未知，无效 observation 保持为无效，损坏证据绝不计入 reward metric。
10. 证据到达浏览器前，必须校验 Hitch 路径、checksum、schema version 与 refinement 归属。
11. 删除插件配置行后，`/refine`、Refine tab、对应 Remote namespace 与事件订阅一并移除，且不破坏 Chat 或普通 Trajectory 视图。
12. 使用该功能不需要独立的 REAR 进程、route 或 data-root 配置。
