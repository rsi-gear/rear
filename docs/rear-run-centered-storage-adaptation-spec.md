# REAR 对 Hitch Run-Centered Storage 的适配 Spec

- 状态：Proposed
- 日期：2026-08-21
- Hitch 基线：`feat/run-centered-trajectory-storage-spec@ec27225`
- Hitch 对比基线：`dev@fe4453a`
- REAR 范围：`<REAR_REPOSITORY_ROOT>`
- 支持目标：RunRecord V1、EvalResult V1、TrajectoryRef V2

## 1. 结论

REAR 必须把数据事实源从 Harbor trial 目录迁移到 Hitch 的：

```text
<HITCH_DATA_ROOT>/runs/<run_id>/
```

Eval 不再拥有一份可供 REAR 读取的轨迹。`evals/<eval_id>/result.json` 只负责把 trial、reward/verifier 状态关联到 `run_id`；run manifest、result、verifier 和 trajectory 才是每次执行的权威记录。

因此本次适配不是给现有 `hitch-events.jsonl` parser 增加几个字段，而是替换 REAR 的发现、关联、状态、聚合和轨迹读取模型：

```text
eval result.trials[*].run_id
              │
              ▼
runs/<run_id>/manifest.json ── identity / context / observation
              ├────────────── result.json
              ├────────────── verifier/result.json
              └────────────── trajectory.ref.json
                                  ├── provider-native evidence
                                  └── canonical DSH session
```

`docs/rear-dsh-trajectory-visualization-spec.md` 中的 ledger、inspector 和并排轨迹交互仍可复用；其中“从 Harbor trial 导出两个固定轨迹文件”“canonical 是唯一轨迹事实源”“按 trial 目录发现新数据”的部分由本 spec 取代。

## 2. Feat 分支已经实现的契约

### 2.1 物理布局

新布局固定为：

```text
<state-root>/
  evals/
    <eval-id>/
      request.json
      resolution.json
      plan.json
      events.jsonl
      result.json
      harbor/...
  runs/
    <run-id>/
      request.json
      resolution.json
      manifest.json
      result.json
      events.jsonl
      verifier/result.json        # benchmark run，存在 verifier 时
      trajectory.ref.json
      trajectory/
        provider/...
        canonical/.../session.jsonl
  indexes/runs.v1.json            # 可删除、可重建，非事实源
```

Harbor bridge 会先在容器内导出完整 `hitch-run-bundle`，Hitch 校验后原子发布到 `runs/<run-id>`，随后删除 eval 目录内的 staging bundle。REAR 不得依赖 staging bundle，也不得继续把 `<trial>/agent/hitch-events.jsonl` 当作新 run 的轨迹来源。

### 2.2 RunRecord V1

`manifest.json` 的 REAR 核心字段如下：

```ts
interface RunRecordV1 {
  run_id: `run_${string}`
  context: RunContextV1
  parent?: {
    kind: "eval"
    eval_id: `eval_${string}`
    trial_id: string
    attempt: number
  }
  status:
    | "queued" | "preparing" | "running"
    | "succeeded" | "failed" | "timed_out" | "cancelled"
  harness: {
    harness_id: string
    requested_ref: string
    revision_identity: Sha256 | null
    artifact_id?: Sha256
    agent_args_sha256?: Sha256
  }
  model: {
    provider?: string
    requested_id: string
    effective_id: string
    parameters_sha256?: Sha256
    identity_resolved?: boolean
  }
  protocol: {
    timeout_ms: number
    workspace_mode: string
    initial_workspace_digest?: Sha256
    environment_identity?: Sha256
    tool_policy_sha256?: Sha256
  }
  observation?: {
    status: "valid" | "invalid"
    reward?: number
    verifier_result_ref?: string
    invalid_reason?: string
  }
  request_ref: string
  resolution_ref: string
  result_ref?: string
  trajectory_ref?: string
  created_at: string
  completed_at?: string
}
```

实现仍会在 manifest 中保留若干扁平冗余字段以及 `started_at`、`sealed` 等扩展字段。REAR parser 必须以新嵌套字段为准并允许未知字段；不得从扁平冗余字段恢复缺失的新字段。

### 2.3 RunContext

```ts
type RunContextV1 =
  | { kind: "ad_hoc" }
  | {
      kind: "seed_task"
      seed_task_id: string
      seed_task_digest: Sha256
      seed_set_id?: string
      seed_set_revision?: string
      iteration_id?: string
    }
  | {
      kind: "benchmark_task"
      benchmark_id: string
      benchmark_revision: string
      task_id: string
      task_digest: Sha256
      verifier_identity: Sha256
    }
```

P0 的现有 Overview/Breakdown 页面只展示 `benchmark_task`。Scanner 和 API 必须保留另外两种 context，避免未来支持 seed/ad-hoc runs 时再次改 wire contract；它们暂不进入 benchmark 分数和任务矩阵。

### 2.4 EvalResult V1

每个完成的 eval 通过 `trials` 引用 runs：

```ts
interface EvalTrialRefV1 {
  trial_id: string
  run_id: string
  task_id: string
  attempt: number
  observation_status: "valid" | "invalid"
  reward?: number
  verifier_result_ref?: string
  invalid_reason?: string
}
```

REAR 必须交叉验证：

- eval result 的 `eval_id` 等于 run `parent.eval_id`；
- `trial_id`、`attempt`、`task_id` 一致；
- eval trial 的 observation、reward、verifier ref、invalid reason 与 run manifest 一致；
- benchmark ID/revision 与 run context 一致。

不一致时把关联标记为 `corrupt`，不得选择一侧继续计分。

注意：`eval.status === "succeeded"` 只表示 Harbor 编排完成，不表示 trials 有有效观测。Feat 的测试明确覆盖了“eval succeeded，但所有 trial 都 invalid”的情况。

### 2.5 TrajectoryRef V2

新 run 的 ref 为：

```ts
interface TrajectoryRefV2 {
  schema_version: "2"
  run_id: string
  fidelity: "provider_native" | "normalized" | "minimal"
  provider?: string
  provider_session_id?: string
  files: Array<{
    role:
      | "provider_events"
      | "provider_transcript"
      | "provider_artifact"
      | "canonical_session"
    path: string
    media_type: string
    sha256: Sha256
    bytes: number
  }>
  redactions?: Array<{ rule_id: string; count: number }>
}
```

当前 engine 的结构化 adapter 通常同时写入：

- `provider_events`：经过显式脱敏、尽量保留 provider 原始 payload 的 NDJSON；
- `canonical_session`：从 Hitch normalized events 投影出的 DSH-compatible session。

纯文本 adapter 写 `provider_transcript`，canonical view 的 fidelity 通常为 minimal。

`TrajectoryRefV2.fidelity = provider_native` 表示 run 保留了 provider-native 证据，不表示 canonical session 本身是 provider-native。REAR 应显示为“Native evidence + canonical view”，不得把 canonical ledger 标成“原生事件”。

## 3. REAR 数据源与发现规则

### 3.1 新布局发现

当 `<root>/runs` 或 `<root>/evals` 存在时，启用 `run-centered-v1` scanner：

1. 扫描 `runs/run_*/manifest.json`，建立以 `run_id` 为键的记录表；
2. 扫描 `evals/eval_*/request.json|plan.json|result.json`，建立 eval 表；
3. 用 `result.trials[*].run_id` 和 run `parent` 双向关联；
4. benchmark 页面只投影 `context.kind === "benchmark_task"` 的 runs；
5. 无 manifest、关联不一致或核心文件损坏的对象进入 diagnostics，不进入分数。

不以 `indexes/runs.v1.json` 为事实源。以后可把它作为冷启动提示，但结果必须能由 manifests 重建。

### 3.2 不支持旧存储

REAR 只扫描：

```text
<root>/runs/run_*/...
<root>/evals/eval_*/...
```

以下输入均不发现、不解析、不回退：

- `<root>/<namespace>/state/<harness>/evals/...`；
- Harbor trial 下的 `agent/hitch-events.jsonl`、`hitch-result.json` 或 bundle staging；
- 任何通过 dataset basename、trial path 或 harness directory 猜测出的记录。

如果 state root 没有 `runs/` 和 `evals/`，API 返回空 snapshot，并附带 `run_centered_store_not_found` diagnostic。不得自动切换旧 scanner。

### 3.3 运行中的 eval

Harbor trial bundle 只有在 backend 返回后才导入全局 run store。因此运行中的 eval 可能只有 `evals/<eval_id>/request.json`、`plan.json` 和 `events.jsonl`，尚无可关联 run。

此时 REAR 展示 eval-level `pending` diagnostic，不伪造 task run。完成后仍无 bundle 时，Hitch 会创建一个标准 diagnostic run；REAR 应像其他 run 一样展示它的 `failed + observation.invalid`，不再使用“稍后会自动关联任务”的旧文案。

## 4. 完整性和路径安全

### 4.1 RunRecord 校验

对新 run 至少校验：

- `run_id` 同时匹配目录名和 `^run_[a-f0-9]{32}$`；
- context、status、identity、timestamp 和相对 ref 字段合法；
- `request_ref`、`resolution_ref`、terminal run 的 `result_ref` 存在且为普通文件；
- `result.run_id/status` 与 manifest 一致；
- terminal benchmark run 有 observation；
- observation 声明 verifier ref 时，该文件存在且为合法 JSON；
- symlink、反斜杠、绝对路径、`..` 和逃逸 run directory 的引用一律拒绝。

`manifest.sealed === true` 的 terminal run 可按 immutable artifact 缓存；未 sealed 或非 terminal run 必须随自动刷新重新检查。

### 4.2 TrajectoryRef V2 校验

读取任何 trajectory 内容前：

- ref `run_id` 必须等于请求的 run；
- 每个 file path 必须是 run directory 内的相对路径；
- 拒绝 symlink 和特殊文件；
- 实际字节数必须等于 `bytes`；
- SHA-256 必须等于 `sha256`；
- NDJSON 每个非空行必须是完整 JSON；
- canonical session 还需校验 header、连续 `seq`、Turn/Step 嵌套和 tool call/result 配对。

任一 declared file 损坏时，run 的 evidence integrity 为 `corrupt`，不能进入 strict metrics。UI 可以在 diagnostic 中指出具体文件，但 API 不返回本机绝对路径。

### 4.3 Ref 版本边界

REAR 只接受 `trajectory.ref.json.schema_version === "2"`。V1 或未知版本统一标记为 `unsupported_trajectory_ref`，不读取其 `path`，也不提供人工查看 fallback。

V2 ref 不携带 `format.contract_commit`。REAR 的 V2 canonical parser 应以 `ref.schema_version=2 + canonical media_type + session header.version=0` 建立格式支持键；界面不得显示一个 ref 中并不存在的 contract commit。后续 Hitch 若升级 session contract，需要先扩展 ref 或由 REAR 显式增加 parser 版本。

## 5. 状态语义

REAR 不再用一个 `RunStatus` 混合执行、评分和数据完整性。新模型至少拆为：

```ts
interface HudRunState {
  execution: RunRecordV1["status"]
  observation:
    | { state: "not_applicable" }
    | { state: "pending" }
    | { state: "valid"; reward: number }
    | { state: "invalid"; reason: string }
  integrity: "valid" | "pending" | "corrupt"
  trajectory: "available" | "raw_only" | "pending" | "missing" | "corrupt" | "unsupported"
}
```

展示规则：

- `succeeded + valid reward=0` 是有效观测，不是基础设施异常；
- `succeeded + invalid` 显示“执行成功 / 观测无效”及 invalid reason；
- `failed|timed_out|cancelled` 保留精确 execution 状态；
- `eval.status` 只在 eval diagnostic 中显示，不覆盖 run 状态；
- `result.error` 是执行错误，`observation.invalid_reason` 是评测有效性错误，两者分别展示；
- 不再以 `reward > 0` 推导“通过”。Hitch V1 没有通用 pass threshold；UI 默认显示 reward/score，只有未来 benchmark contract 明确提供 threshold 时才显示 pass/fail。

推荐的 invalid reason 文案至少覆盖：

```text
trajectory_missing_or_corrupt
verifier_result_missing
infrastructure_failure
cancelled
```

## 6. Benchmark、身份和聚合

### 6.1 Benchmark 与 task key

删除当前基于 dataset basename、`@`、`-2.0` 的推断。使用 manifest context：

```text
benchmark key = (benchmark_id, benchmark_revision)
task key      = (benchmark_id, benchmark_revision,
                 task_id, task_digest, verifier_identity)
```

同一个 `task_id` 下出现多个 digest 或 verifier identity 时，必须拆成不同 task identity，或在同一展示行中明确标出 identity conflict；不得静默合并得分。

### 6.2 Harness、model 和 protocol identity

分组和比较使用完整 identity，不使用展示名：

```text
harness = (harness_id, revision_identity, artifact_id, agent_args_sha256)
model   = (provider, effective_id, parameters_sha256, identity_resolved)
protocol = manifest.protocol 的 canonical JSON
```

`requested_ref`、`requested_id` 只用于展示请求值。主标签优先显示 effective model 和精确 harness revision；alias 或 unresolved identity 必须有显眼标记。

### 6.3 有效分数

Overview 和 matrix 只聚合同时满足以下条件的 runs：

- `context.kind === benchmark_task`；
- `observation.status === valid` 且 reward 是有限 number；
- run core record、trajectory、verifier 均通过完整性校验。

Invalid runs 单独计数，不能当 0 分，也不能从异常计数中消失。`eval.result.summary` 可用于交叉检查，`backend_summary` 只用于 Harbor diagnostic，不能替代 run observation 汇总。

### 6.4 Strict comparison

REAR 的 strict compatibility 必须与 Hitch `compareRunRecords` 一致。以用户第一条选择或显式选择的 reference run 为基准：

- 比模型：task、harness、protocol 完全相同，只允许 model 不同；
- 比 harness：task、model、protocol 完全相同，只允许 harness 不同；
- model/harness identity 未解析、trajectory/verifier/core record 损坏或 observation invalid 时，输出具体 exclusion reason；
- 至少有两个可分组 identity，且被比较维度已解析，才显示 `Strict`。

视觉并排查看可以允许不严格兼容的 runs，但必须在 Compare heading 显示 `Exploratory`，逐条列出不兼容原因；这类选择不得产生“模型 A 优于模型 B”的聚合结论。

需要支持 Hitch 实现中的 reason code：

```text
not_benchmark_task
benchmark_reference_missing
benchmark_revision_mismatch
task_digest_mismatch
verifier_identity_mismatch
harness_identity_mismatch
model_identity_mismatch
protocol_identity_mismatch
harness_identity_unresolved
model_identity_unresolved
trajectory_missing_or_corrupt
verifier_result_missing
infrastructure_failure
cancelled
```

## 7. Trajectory 读取与 UI

### 7.1 两层证据视图

Compare 页必须明确区分：

1. **Canonical view**：跨 provider 的 Turn/Step/Assistant/Tool ledger，用于并排比较；
2. **Provider evidence**：provider events/transcript/artifact 的只读原始证据，用于核查 canonical 投影。

默认打开 canonical view。Provider evidence 通过 inspector 的 Raw/Native tab 懒加载，不把 provider-specific payload 强行投影成统一 record。

如果 ref 有 provider evidence 但无 `canonical_session`，状态为 `raw_only`：允许查看原始证据，但不显示空的 canonical ledger。如果只有 canonical session，则可以比较，但 badge 显示 `normalized` 或 `minimal`，不能声称保留了 provider-native evidence。

显示 `redactions` 的 rule/count 摘要；这表示持久化前已脱敏，不应被当作轨迹损坏。

### 7.2 Canonical summary

从 canonical session 派生：

- `turnCount`：`turn/start` 数量；
- `stepCount`：`step/start` 数量；
- `toolCalls`：`tool/call` 数量；
- `toolFailures`：配对 result 的 `message.content[*].isError === true` 或 `data.error`；
- usage：对 `assistant/message.data.usage` 的 `inputTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens` 求和；
- errors：turn error reason、tool failure，以及 error-level diagnostic。

当前实现没有稳定的通用 reasoning token 或 cost 字段。缺失时显示 `—`，不得从旧 `usage.updated` 或价格表补算。

当前 projector 通常不会把 normalized `message.delta` 写成 `assistant/chunk`；因此 TTFT 对新 V2 canonical run 通常是未知值。除非 canonical session 真实存在 chunk token 时间，否则不得显示 `0ms` 或用 provider raw timestamps 猜测。

### 7.3 时间

区分三种时间：

- lifecycle：manifest `created_at -> completed_at`；
- agent execution：优先 `result.started_at -> result.completed_at`；
- Harbor phases：通过 `parent.eval_id/trial_id` 可选关联 Harbor raw trial，仅作 backend diagnostic。

PhaseStrip 缺少任一 sidecar 时允许部分展示。Harbor phase 不是 RunRecord identity，也不能覆盖 run/result 的执行时间。

### 7.4 Detail 加载

`GET /api/hitch-data` 只返回 benchmark/run summary，不携带完整 session 或 provider events。

新增：

```text
GET /api/hitch-trajectory?run=run_<32hex>&view=canonical
GET /api/hitch-trajectory?run=run_<32hex>&view=provider&file=<ordinal>&cursor=...
```

要求：

- API 只接受已索引的 run id 和 ref file ordinal，不接受任意路径；
- canonical 响应返回投影后的 document，而不是暴露本机文件名；
- provider NDJSON/transcript 分页读取并限制单响应大小；
- canonical ETag 使用 ref 中 canonical file digest；provider ETag 使用对应 file digest；
- Compare 同时最多加载选中的 4 条 canonical trajectory，离开页面取消请求；
- overview 的 10 秒轮询不重复读取 immutable trajectory body。

建议的 summary wire type：

```ts
interface HudRunSummary {
  id: string                 // 等于 run_id
  evalId: string | null
  parent: EvalRunParentV1 | null
  context: RunContextV1
  execution: RunRecordV1["status"]
  observation: HudObservation
  integrity: "valid" | "pending" | "corrupt"
  harness: HarnessIdentityV1
  model: ModelIdentityV1
  protocol: ProtocolIdentityV1
  result: {
    startedAt: string | null
    completedAt: string | null
    error: { code: string; message: string } | null
  }
  trajectory: {
    availability: "available" | "raw_only" | "pending" | "missing" | "corrupt" | "unsupported"
    refSchema: "2" | null
    evidenceFidelity: "provider_native" | "normalized" | "minimal" | null
    provider: string | null
    providerSessionId: string | null
    hasCanonical: boolean
    providerFiles: number
    redactions: Array<{ ruleId: string; count: number }>
    summary: CanonicalTrajectorySummary | null
    diagnostic: string | null
  }
  backendPhases: RunPhases | null
}
```

## 8. 页面改动

### 8.1 Overview

- Benchmark selector 使用 `(benchmark_id, benchmark_revision)`；revision 显示原值，不再解析成伪 semver。
- score 分母只包含 valid observations；同时显示 invalid、running、corrupt 数量。
- “通过任务运行”改为“有效观测”，除非 benchmark 以后声明 pass threshold。
- model/harness matrix 的 label 带 effective model、revision 短摘要和 unresolved badge。
- 同一展示 label 对应多个 identity 时必须拆列或显示冲突，不能按字符串合并。
- 删除 `storageNamespaces`；state root 只在本地连接 diagnostic 中展示，不参与 benchmark identity。

### 8.2 Breakdown

- task 行以完整 task key 建立；展示 `task_id`，详情显示 digest 和 verifier identity。
- 每个 run chip 同时显示 execution、observation 和 integrity，而不是一个综合色 badge。
- reward 0 正常显示为有效 observation。
- 选择 2–4 条轨迹时即时计算 strict compatibility；不兼容仍可 exploratory compare，但先显示原因。
- attempt 读取 `parent.attempt`，不从 trial name 再猜。

### 8.3 Compare

- Run header 显示 run id、eval/trial parent、精确 harness/model/protocol identity。
- 增加 `Strict` / `Exploratory` badge 和 exclusion reason panel。
- trajectory badge 分别表达 evidence fidelity 与 canonical availability。
- 保留 canonical DSH ledger、共享过滤、同步滚动和 inspector。
- 增加 Provider Evidence tab，按 file role/media type 列表查看。
- verifier reward/result 位于 run summary，不注入 session ledger。
- `buildInsights` 只对 strict-compatible 且 valid 的 runs生成结论；exploratory 模式只陈述可观察差异，不给性能优劣结论。

## 9. 文件级改动建议

| 文件/目录 | 改动 |
| --- | --- |
| `lib/hitch-types.ts` | 用 RunContext/identity/observation/integrity/trajectory descriptor 取代当前扁平 `HitchRun`；删除旧 trace 类型。 |
| `lib/hitch-scanner.ts` | 降为 run-centered scanner facade；不再扫描 Harbor trial 目录。 |
| `lib/hitch/run-record.ts` | manifest/result/core refs parser、projection 和完整性校验。 |
| `lib/hitch/eval-record.ts` | eval parser、trial/run 双向 join 与一致性校验。 |
| `lib/hitch/trajectory-ref.ts` | V2 ref parser、path/size/hash 校验和 capability descriptor；其他 schema 直接拒绝。 |
| `lib/hitch/canonical-session.ts` | DSH v0 reader、关系不变量、summary 与 record projection。 |
| `lib/hitch/strict-comparison.ts` | 镜像 Hitch comparison identity 和 reason-code 语义。 |
| `lib/hitch/cache.ts` | sealed run、ref digest、projected document 和 ETag cache。 |
| `build/hitch-data-plugin.ts` | 从 `vite.config.ts` 提取 local API，提供 summary/detail/provider paging。 |
| `vite.config.ts` | 注册新 plugin；不把本地文件 API 带入 hosted worker。 |
| `app/rear-dashboard.tsx` | 拆分页面，移除对 `run.events`、reward>0 pass 和字符串 identity 分组的依赖。 |
| `app/trajectory/*` | canonical lane、identity panel、strict diagnostics、provider evidence viewer。 |
| `tests/fixtures/run-centered/*` | run/eval/ref/canonical/provider/corrupt fixtures。 |

REAR 含 `.openai/hosting.json`，但本功能仍是 local-only filesystem capability。生产 worker 不增加读取本机 Hitch root 的 endpoint，也不上传轨迹到 D1/R2。

## 10. 实施顺序

### Phase 0：契约 fixture

- 从 `agent-hitch@ec27225` 固化 V1 manifest、eval result、V2 ref、provider events 和 canonical session fixtures；
- 增加 Hitch comparison 输出 golden fixtures，防止 REAR reason code 漂移；
- 增加旧 layout 和 TrajectoryRef V1 的 negative fixtures，断言系统明确拒绝而不是回退解析。

### Phase 1：RunRecord summary 迁移

- 实现 root discovery、run/eval join 和完整性校验；
- 改造 `/api/hitch-data`，停止返回新 run 的 `events`；
- 更新 Overview/Breakdown 的状态和聚合语义；
- 此阶段即可正确显示新 eval，即使 Compare 暂时只给 canonical basic view。

### Phase 2：TrajectoryRef V2

- 实现 V2 file verification、canonical reader/projector、provider evidence descriptor；
- 新增按 run 懒加载 endpoint 和 cache；
- 接入 canonical ledger、raw/native inspector 与 redaction 提示。

### Phase 3：Strict comparison

- 对齐 Hitch comparison contract；
- 在 Breakdown/Compare 增加 reference、Strict/Exploratory 和 exclusion reasons；
- 限制 insights 与 score conclusions 的适用范围。

### Phase 4：性能收尾

- provider file 分页、canonical virtual list、ETag/304、请求取消；
- running eval、large trajectory 和 corrupt artifact 压测；
- 删除旧 `hitch-events` parser、EventCard 数据路径和无用类型。

## 11. 测试要求

### Scanner / join

- 新 root 中 direct、seed、benchmark 和 diagnostic runs；
- eval succeeded 但 trials 全 invalid；
- eval trial 与 run parent/task/observation 不一致；
- running eval 尚无 run bundle；
- 旧 namespace root 返回 `run_centered_store_not_found`，不产生 runs；
- 同 task name 不同 digest/verifier 不被合并。

### 状态 / 聚合

- valid reward 0 仍进入均值且不算 infrastructure error；
- invalid observation 不进入均值；
- failed/timed_out/cancelled 精确显示；
- requested/effective model 不同；
- 同名模型但 parameters digest 不同；
- eval backend summary 不覆盖 run observation summary。

### Integrity / security

- core ref 缺失、result identity/status mismatch；
- V2 bytes/hash mismatch、非法 JSONL、symlink、absolute/traversal path；
- canonical header/seq/bracket/tool pairing 损坏；
- TrajectoryRef V1 和未知 schema 被拒绝且不读取其 path；
- API 任意 run id、file path、ordinal 越界和超大响应限制。

### Comparison

- model comparison 固定完整 harness/protocol/task identity；
- harness comparison 固定完整 model/protocol/task identity；
- 每一种 Hitch reason code 的 golden case；
- unresolved variable identity 导致 non-strict；
- exploratory compare 可查看轨迹，但不生成 strict insight。

### UI

- Overview 同时显示 valid/invalid/running/corrupt；
- Breakdown run chip 展示三层状态；
- 1、2、4 lane canonical compare；
- `raw_only`、minimal、unsupported、missing、corrupt empty state；
- Provider Evidence 按角色展示、分页并显示 redaction summary；
- 缺失 cost/reasoning/TTFT/phase 时显示 `—`。

## 12. 验收标准

1. 新 Hitch eval 完成后，REAR 只通过 `eval.result.trials[*].run_id` 和 `runs/<run_id>` 展示 trial；不读取 staging bundle 作为事实源。
2. benchmark/task/model/harness/protocol 全部来自 RunRecord identity，不再由路径或展示字符串猜测。
3. reward 0 的 valid observation 被正确计分；invalid observation 不转成 0 分。
4. eval succeeded 但 trials invalid 时，Overview 显示 0 个有效观测和对应 invalid reasons，而不是成功分数。
5. V2 trajectory 所有 declared files 经过 path、size、hash 校验；损坏 run 不进入 strict metrics。
6. Compare 默认用 canonical session 做跨 provider ledger，同时可核查 provider-native evidence；两者的 fidelity 标签不混用。
7. 同 task 名但 digest/verifier 不同、同 model 名但 parameters/effective identity 不同的 runs 不被静默聚合。
8. 非 strict 的 2–4 条轨迹仍可 exploratory 查看，但 REAR 明确列出 exclusion reasons，且不生成优劣结论。
9. `/api/hitch-data` 不携带全部 trajectory body；detail 只接受安全 run id，immutable run 可命中 ETag/cache。
10. 旧 namespace、Harbor trial 日志和 TrajectoryRef V1 均不会被解析；UI 返回明确的不支持或未发现新 store 状态。
11. `npm run build`、现有 SSR 测试及新增 scanner/ref/comparison/UI 测试通过。

## 13. 已知实现边界

- TrajectoryRef V2 没有 `contract_commit`，REAR 无法仅从 ref 判断 DSH contract 的精确 commit；P0 只能显式支持 session header version 0。
- 当前 model identity 常可能仍是 alias，`identity_resolved !== true` 时比较只能是 exploratory。
- `provider_artifact` 是开放角色，P0 只提供安全下载/元数据，不推断 provider-specific 语义。
- 新 eval 的 run 只在 Harbor backend 返回并完成 import 后出现在全局 store；P0 不从 disposable container 做实时 trajectory streaming。
- Hitch 当前 strict comparison 以一个 reference run 做 pairwise identity 检查；REAR P0 必须镜像这一语义，不自行引入另一套分组规则。
