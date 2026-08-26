# Gear refine × Hitch × REAR Benchmark 增量刷新实现 Spec

状态：Implemented（2026-08-26）
目标仓库：`gear`、`agent-hitch`、`rear`
目标能力：Gear refine 运行 benchmark 时，每完成一个可验证的 trial（一个 task × attempt）即在 REAR 展示；不等待整个 Hitch eval/benchmark 结束。

## 1. 结论

本功能不通过 REAR 扫描 Harbor 临时目录或猜测 `runs/` 归属实现，而增加两份明确的耐久关联：

1. Gear 在 evaluation 启动前，把 `eval_id`、round、phase 和 candidate 的 ownership 写入 round state；
2. Hitch 在每个 Harbor trial 完成、run bundle 校验并原子发布后，更新 `evals/<eval_id>/progress.json`；
3. REAR 仅在 Gear ownership 与 Hitch progress/run record 双向一致时展示该 trial；
4. eval 结束后，Hitch 仍只写一次 terminal `result.json`，Gear 的选拔与晋升仍只使用完整 terminal evidence。

增量刷新单位定义为 **trial**，而不是展示层的 task。若 `attempts > 1`，同一 task 的每个 attempt 都可独立出现；task 分数和比较在 attempts 未齐时必须标记为 provisional。

## 2. 当前实现为何只能整批展示

### 2.1 Gear

`gear/src/evaluator/hitch-cli.ts` 当前执行 `hitch eval run --output json` 并等待子进程退出，随后才从最终 JSON 中得到 `eval_id` 和完整 `trials`。

`gear/src/refine/service.ts` 也只在 `evaluator.evaluate(...)` resolve 后把 `baseline`、`seedEvaluation` 或 `heldOutEvaluation` 写入 round。运行中的 round 有 phase 状态，但没有当前 Hitch eval 的权威 ID 和 candidate ownership。

### 2.2 Hitch

`agent-hitch/src/evals/service.ts` 当前顺序是：

```text
await runHarborBackend(...)
await importEvalTrialRuns(...all trials...)
atomicWriteJSON(result.json)
```

因此 Harbor 进程存活期间，即使某个 trial 已完成，`runs/<run_id>` 和 eval trial ref 仍未进入 Hitch 全局事实存储。

`agent-hitch/integrations/harbor/hitch_harbor_agent.py` 目前直接创建 `hitch-run-bundle/` 并逐文件复制。该目录在复制期间可见，不能作为并发 importer 的 ready signal。

### 2.3 REAR

`rear/src/runtime.ts` 当前只从 Gear 的完整 evaluation evidence 创建 `RefinementEvaluationRef`，并要求 Gear run IDs 与 Hitch terminal `result.json.trials[*].run_id` 集合完全相等。

`rear/src/hitch-provider.ts` 在 `result.json` 不存在时返回 `running + runs: []`。文件监听、Host invalidation 和浏览器 authoritative resync 已存在，可以直接复用；问题不在刷新通道，而在上游没有可消费的 partial authority。

## 3. 目标与非目标

### 3.1 目标

- Harbor trial 完成并产生 verifier 结果后，Hitch 立即校验、封存并发布对应 run；
- Hitch 每发布一个 trial 后原子更新 eval progress；
- REAR 在本地文件系统场景下，目标是在 progress 发布后 2 秒内展示新 trial；实际延迟由 Hitch 扫描间隔、REAR debounce 和浏览器 RPC 往返共同决定；
- partial score、task coverage、attempt 数、轨迹入口随 progress 更新；
- final `result.json` 与当前调用方保持兼容；
- 保留 Gear/Hitch ownership、run parent、benchmark、task、attempt、observation 和 trajectory 完整性校验；
- 旧 Gear round 和旧 Hitch eval 没有新字段/文件时仍按整批模式工作。

### 3.2 非目标

- 不从仍在执行的 trial 容器流式读取 live trajectory；
- 不在 trial 完成前展示未封存事件；
- 不允许 Gear 根据 partial score 提前选拔、停止 benchmark 或晋升 candidate；
- 不让 REAR 读取 `harbor/job/**`、`hitch-run-bundle` 或其他 staging 内容；
- 不把 `result.json` 改造成可变的 running document；
- 不保证外部或旧 Harbor 版本在 job 结束前不落单 trial result 时仍能逐 trial 刷新；这种情况下必须安全回退到 final drain。

## 4. 权威数据与优先级

| 数据 | 权威来源 | 可变性 | 用途 |
| --- | --- | --- | --- |
| eval 属于哪个 Gear round/candidate | Gear `evaluationAttempts[]` | round 原子更新 | 防止 REAR 发现并展示无主 eval |
| 运行中 eval 已发布哪些 trial | Hitch `progress.json` | eval 运行期间原子替换 | partial membership |
| terminal eval 的完整 trial 集合 | Hitch `result.json` | 一次性 terminal artifact | final membership/status |
| 单个 run 的执行、observation、identity | Hitch `runs/<run_id>/manifest.json` 及 refs | sealed 后不可变 | 分数、完整性和轨迹 |
| Gear 决策使用的完整 evidence | Gear round 的 existing evaluation evidence | evaluation 返回后写入 | selection/promotion |

优先级规则：

1. `result.json` 存在时，它是 eval membership 的最终权威；
2. `result.json` 不存在时，只有 Gear attempt ownership + Hitch `progress.json` 同时存在才能展示 partial runs；
3. `progress.json` 不得覆盖或修正 terminal `result.json`；两者冲突时 eval 标记为 `corrupt`，相关 runs 不进入分数；
4. 只有 run record 与 progress/result 中的 trial ref 完全一致时才展示 run；
5. Gear final evidence 出现后，继续执行现有 Gear run set 与 Hitch final run set 完全相等校验。

## 5. 端到端时序

```text
Gear RefineService       Gear Hitch evaluator       Hitch eval          Harbor trial       REAR
       |                         |                       |                    |                |
       | reserve() -> eval_id    |                       |                    |                |
       | persist attempt owner   |                       |                    |                |
       |------------------------>| eval run --eval-id   |                    |                |
       |                         |---------------------->| create request/plan/progress         |
       |                         |                       |------------------->| run trials      |
       |                         |                       |<-------------------| trial result     |
       |                         |                       | validate/import run                  |
       |                         |                       | atomic rename runs/<run_id>          |
       |                         |                       | atomic replace progress.json         |
       |                         |                       |------------------------------------->| resync
       |                         |                       |                    |                | show trial
       |                         |                       |<-------------------| next trial       |
       |                         |                       | ... repeat ...                       |
       |                         |                       | final drain + validate               |
       |                         |                       | atomic write result.json             |
       |                         |<----------------------| final result                         |
       | persist complete evidence/decision             |                    |                |
       |-------------------------------------------------------------------------------------->| final resync
```

发布顺序必须是：

```text
sealed run directory rename
  -> progress.json atomic replace
  -> eval.trial.published event
```

REAR 因此永远不会被一个正常 progress ref 引导到尚未发布的 run。

## 6. Gear 改动

### 6.1 两阶段 evaluator contract

在 `gear/src/types.ts` 为支持增量发现的 evaluator 增加可选 reservation 能力：

```ts
export interface EvaluationReservation {
  provider: string
  evalId: string
}

export interface RefineEvaluator {
  reserve?(
    round: Readonly<RefinementRound>,
    request: Readonly<EvaluationRequest>,
  ): Promise<EvaluationReservation>

  evaluate(
    round: Readonly<RefinementRound>,
    request: Readonly<EvaluationRequest>,
    signal: AbortSignal,
    reservation?: Readonly<EvaluationReservation>,
  ): Promise<EvaluationEvidence>
}
```

规则：

- `reserve` 不启动外部 benchmark，只生成 provider-owned ID；
- 不实现 `reserve` 的自定义 evaluator 保持现有整批行为；
- 实现 `reserve` 的 evaluator 必须接受自己生成的 reservation；
- `evaluate` 返回的 `provider/evalId` 必须与 reservation 相等，否则 fail closed；
- reservation ID 不能复用到另一个 round、phase 或 candidate。

`HitchCliEvaluator.reserve()` 生成 `eval_[a-f0-9]{32}`，`evaluate()` 增加：

```text
hitch eval run --eval-id <reserved-id> ...
```

Gear 不解析或修改 Hitch eval 内容；ID 仍属于 Hitch namespace，Gear 只预登记引用。

### 6.2 Round state 增加 evaluation attempt ownership

在 `RefinementRound` 增加向后兼容的可选字段：

```ts
export interface RoundEvaluationAttempt {
  provider: string
  evalId: string
  phase: EvaluationPhase
  owner: {
    candidateId: string
    role: 'baseline' | 'candidate'
    harnessRef: HarnessRef
  }
  conditionId: string
  dataset: string
  requestedModelId: string
  requestedCommit: HarnessRef
  status: 'running' | 'settled' | 'failed' | 'cancelled'
  startedAt: string
  completedAt?: string
  failure?: { code: string; message: string }
}

export interface RefinementRound {
  // existing fields...
  evaluationAttempts?: RoundEvaluationAttempt[]
}
```

`evaluationAttempts` 是 Gear 对 eval ownership 的权威记录，但不是 trial/reward 的副本。

写入规则：

1. `reserve()` 成功后、调用 `evaluate()` 前，原子追加 `status: running` attempt；
2. owner 必须由当前调用点显式传入：
   - champion/parent seed baseline：对应 population candidate，找不到时使用当前确定性的 `champion-<harnessRef>`；
   - seed candidate：正在评测的 candidate；
   - held-out baseline：当前 champion candidate；
   - held-out candidate：promotion finalist；
3. evidence resolve 后，在写入 existing evaluation evidence 的同一次 round update 中把 attempt 改为 `settled`；
4. evaluator 抛错或取消时，把 attempt 改为 `failed/cancelled` 并保留 failure；
5. attempt 不删除。它既支持运行中发现，也支持失败 eval 的事后诊断；
6. 同一 round 内 `(provider, evalId)` 唯一；owner、phase、dataset、condition 和 commit 一经写入不得改变。

建议在 `RefineService` 增加统一 helper，替换所有直接 `evaluator.evaluate(...)` 调用，避免某个 phase 漏记 attempt：

```ts
evaluateWithAttempt(round, request, owner, signal)
```

### 6.3 State validation

`gear/src/state/store.ts` 必须验证：

- Hitch attempt 的 `evalId` 满足 `^eval_[a-f0-9]{32}$`；其他 provider 至少为非空安全 identity；
- candidate owner 必须能由 round 自身验证：candidate 来自 `candidatePool`；baseline 的 harness 必须等于 `targetHarnessRef` 或某个 `parentAllocation.parentHarnessRef`，ID 必须等于对应 parent candidate 或确定性的 `champion-<harnessRef>`；
- seed/held-out attempt 的 dataset、condition 和 model 分别匹配 `round.plan.seed/heldOut`；
- requested commit 等于 owner harness ref；
- terminal attempt 必须有 `completedAt`，running attempt 不得有；
- attempt 存在时，final Gear evidence 的 `provider/evalId/dataset/requestedCommit` 必须与对应 attempt 一致；
- 旧 round 没有 `evaluationAttempts` 时继续通过验证。

### 6.4 Gear 行为边界

- partial progress 不进入 `EvaluationEvidence`；该类型继续表示完整、可用于决策的 evidence；
- `pairedTrials`、judges、selection、promotion 只在 `evaluate()` 返回完整 terminal evidence 后执行；
- public `/refine` 状态可以继续只报告 phase，不要求把 partial rewards 暴露到 Gear command response；
- Gear 失败时不得删除 attempt，即使 Hitch 已发布部分 runs。

## 7. Hitch 改动

### 7.1 显式 eval ID 与独占创建

`agent-hitch/src/cli/commands/eval.ts` 的 `eval run` 增加：

```text
--eval-id eval_<32 lowercase hex>
```

`runEval({ evalId })` 已有 programmatic 参数，但实现必须从 recursive `ensureDir` 改为独占 reservation：

- 校验 ID 格式；
- 使用 `mkdir(evalDirectory, { recursive: false })` 或等价 `wx` reservation；
- 目录已存在时返回稳定错误 `eval_id_conflict`，不得覆盖、续跑或复用旧 eval；
- 未提供 `--eval-id` 时继续由 Hitch 生成 ID，保持 CLI 兼容。

### 7.2 新增 progress schema

新增 `evals/<eval_id>/progress.json`：

```json
{
  "schema_version": "1",
  "eval_id": "eval_...",
  "benchmark_id": "terminal-bench",
  "benchmark_revision": "2.0",
  "status": "running",
  "generation": 3,
  "planned_tasks": null,
  "planned_trials": null,
  "trials": [
    {
      "trial_id": "regex-log__abc",
      "run_id": "run_...",
      "task_id": "regex-log",
      "attempt": 1,
      "observation_status": "valid",
      "reward": 1,
      "verifier_result_ref": "verifier/result.json"
    }
  ],
  "summary": {
    "settled_trials": 1,
    "valid_trials": 1,
    "invalid_trials": 0
  },
  "started_at": "2026-08-26T00:00:00.000Z",
  "updated_at": "2026-08-26T00:01:00.000Z"
}
```

Schema 规则：

- 文件通过 `atomicWriteJSON` 整体替换，禁止 in-place mutation；
- `status` v1 固定为 `running`；terminal 状态只属于 `result.json`；
- `generation` 从 0 开始，每次 trial set 改变严格递增；
- trials 使用与 `EvalResultV1.trials` 相同的 `EvalTrialRefV1`；
- `(trial_id)`、`(run_id)` 唯一；同一个 trial 的 ref 不可被替换；
- trials 按 `(task_id, attempt, trial_id)` 稳定排序，不能使用完成顺序作为 durable identity；
- 本地 Harbor dataset 在启动前枚举顶层含 `task.toml` 的任务目录，并把排序后的不可变 task ID 写入 `plan.json.tasks`；此时 `planned_tasks` 和 `planned_trials = planned_tasks × attempts` 必须从 generation 0 起写入准确值；
- registry-backed dataset 等无法在启动前权威确定任务集合时，`planned_tasks/planned_trials` 为 `null`，不得根据当前输出目录数猜总数；
- summary 只是便捷计数，REAR 仍从已校验 run 计算展示分数；
- `result.json` 出现后 progress 不再更新。progress 可以保留用于审计，但读取方必须以 result 为先；
- 新增 `docs/schemas/eval-progress.schema.json` 和 domain type `EvalProgressV1`。

初始化时机：`request.json`、`resolution.json` 和 `plan.json` 已原子写入后、启动 Harbor 前，写 generation 0 的空 progress。

### 7.3 原子发布 Harbor bundle

修改 `integrations/harbor/hitch_harbor_agent.py`：

```text
/logs/agent/.hitch-run-bundle.<nonce>/   # copy and validate staging
  ...
  bundle.complete.json
rename -> /logs/agent/hitch-run-bundle/
```

`bundle.complete.json` 至少包含 `schema_version`、`run_id`、`eval_id`、`trial_id`、`completed_at`。目录 rename 与 trial log 目录必须位于同一文件系统。

该 marker 在 importer 复制到 Hitch temporary root 后必须被移除，不进入 sealed `runs/<run_id>`。

Importer 只有同时满足以下条件才处理 trial：

- Harbor trial `result.json` 可完整解析，并含稳定 `trial_name/task_name`；
- `hitch-run-bundle/bundle.complete.json` 存在且 identity 一致；terminal trial 没有 bundle 时，live monitor 先按 readiness race 重试，默认两秒 grace period 到期或进入 final drain 后生成 diagnostic run；
- 不读取 `.hitch-run-bundle.*`。

该 marker 只表示 staging 已完整导出，不成为 REAR 可读取的事实源。

### 7.4 Harbor 运行期间监控已完成 trial

在 `agent-hitch/src/backends/harbor/backend.ts` 增加一个与 Harbor 子进程并行的 trial monitor：

- 默认每 250 ms rescan `harbor/job/*/result.json`；不要只依赖 `fs.watch`；
- JSON 尚未写完整、bundle 尚未 ready 时视为“稍后重试”，不是 corrupt；
- 每个 `trial_id` 只向上游 callback 一次；
- callback 必须是 async 串行消费，避免 progress lost update；
- Harbor 退出后停止周期扫描，并执行一次 final drain；
- 支持 AbortSignal，monitor 自身不得阻止取消和进程回收；
- 如果所用 Harbor 版本只在 job 结束时暴露 trial results，monitor 不猜测结果，final drain 保持原有整批语义。

建议 contract：

```ts
interface RunHarborBackendOptions {
  // existing fields...
  onTrialSettled?: (trial: Record<string, unknown>) => Promise<void>
}
```

### 7.5 单 trial、幂等 importer

把 `agent-hitch/src/evals/trial-import.ts` 拆为：

```ts
importEvalTrialRun(options, trial): Promise<EvalTrialRefV1>
importEvalTrialRuns(options, trials, existingRefs): Promise<EvalTrialRefV1[]>
```

单 trial 流程：

1. 从 Harbor lock/result 得到 canonical `task_id/trial_id/attempt`；
2. 校验 bundle run context、benchmark、verifier identity 和 parent eval/trial/attempt；
3. 复制到 Hitch temporary root；
4. 添加 verifier、observation、portable refs 和 `sealed: true`；
5. 使用现有 `loadRunRecord(...verifyTrajectory: true)` 完整校验；
6. rename 到 `runs/<run_id>`；
7. 返回 `EvalTrialRefV1`；
8. `run` 发布成功后才删除 Harbor staging bundle。

幂等规则：

- progress 已含相同 `trial_id` 时，重新校验已发布 run 后返回相同 ref；
- destination run 已存在而 progress 尚未写入时，只有当 existing run 与 bundle/parent/observation 全部一致才允许恢复 ref；
- 同一 trial 指向不同 run，或同一 run 被两个 trial 引用时 fail closed；
- incremental callback 与 final drain 通过同一串行队列或 eval-local lock 执行；
- import 失败时保留 bundle 和 `hitch-run-import-error.json`，并按当前语义生成一个 sealed diagnostic run；diagnostic ref 同样进入 progress。

### 7.6 Progress 与 final result

`runEval()` 在 `onTrialSettled` 中执行：

```text
import one trial
validateEvalTrialReferences(one ref)
merge into in-memory/current progress
atomicWriteJSON(progress.json)
emit eval.trial.published
```

Harbor 退出后：

1. final drain 所有 backend trial results；
2. 对已发布 trial 做幂等验证，对未发布 trial 执行 import；
3. 验证 backend terminal trial identities 与 progress trial identities 完全相等；
4. 验证 progress 中每个 ref 与 run record 双向一致；
5. 用同一组 refs 构建 terminal `result.json`；
6. 原子写 `result.json`；
7. emit `eval.completed/eval.failed`；
8. 此后禁止修改 progress 和 result。

如果 eval 在 Harbor 完成前取消或 Hitch 内部失败，catch 分支必须从已落盘 progress 恢复 `trialRefs`，写 terminal failed/cancelled result。这样已发布的部分 runs 不丢失，但 Gear 仍将整个 evaluation 视为失败，不用于决策。

新增 event：

```json
{
  "type": "eval.trial.published",
  "eval_id": "eval_...",
  "trial_id": "...",
  "task_id": "...",
  "attempt": 1,
  "run_id": "run_...",
  "observation_status": "valid",
  "settled_trials": 3,
  "generation": 3
}
```

event 是审计/CLI progress 输出，不替代 `progress.json`。

## 8. REAR 改动

### 8.1 读取 Gear attempt ownership

在 `rear/src/runtime.ts` 的 Gear round schema 增加可选 `evaluationAttempts` parser。

投影规则：

- attempt owner 先进入 candidate accumulator；运行中的 baseline 不再临时生成另一个 `initial-*` candidate；
- attempt 可在完整 Gear evidence 尚未存在时创建 evaluation association；
- 同一 `evalId + candidateId` 的 final evidence 出现后替换/增强 partial association，不产生重复 evaluation；attempt 为 failed/cancelled 时应投影为现有 `failedEvaluation` 语义；若同时存在 Gear `failedEvaluations` terminal evidence，以后者的完整 run set 和 failure 为准并与 attempt 交叉验证；
- attempt 和 final evidence 的 owner、phase、dataset、commit 或 eval ID 冲突时整个 Gear record fail closed；
- 旧 round 没有 attempts 时沿用当前 final-evidence-only 路径。

Gear attempt 刚落盘而 Hitch eval 目录尚未创建是正常 race。REAR 必须：

- 把该 association 视为 queued，不把 record 标记 error；
- 即使还构造不出完整 `RefinementEvaluationRef`，也按原始 `(provider, evalId)` 建立 Hitch eval/root watch；
- Hitch `request/progress` 出现后由该 watch 触发 authoritative rescan。

为此可把 `HitchRefinementEvidenceProvider.watch(ref, ...)` 拆成或扩展为：

```ts
watchEval(evalId: HitchEvalId, onChange: () => void): () => void
```

它不需要预先知道 benchmark identity，但仍严格校验 eval ID 格式。

### 8.2 Eval identity 解析

把当前只读 terminal `result.json` 的 `hitchEvalIdentity()` 分为两条路径：

- final Gear evidence：必须读取 `result.json` 并执行现有完整 run-set equality；
- running Gear attempt：从 Hitch `request.json/progress.json` 读取 benchmark ID/revision，两个文件同时存在时必须相等。

不得根据 Gear dataset 字符串自行推导 local benchmark digest。

### 8.3 Hitch provider 支持 progress

`rear/src/hitch-provider.ts` 的 evaluation 读取顺序：

```text
if result.json exists:
  parse terminal result
  if progress exists, validate it has the exact same trial set and identities
  load terminal runs
else if progress.json exists:
  parse running progress
  load progress runs
else:
  return queued/running with zero runs
```

partial run 必须执行与 final run 相同的校验：

- progress eval/benchmark identity；
- unique run/trial identity；
- manifest parent eval/trial/attempt；
- manifest benchmark/task context；
- observation status/reward/verifier ref；
- sealed terminal run record 和 trajectory integrity。

输出：

- evaluation `status: running`；
- `settledTasks` 为已发布 distinct task 数；
- `plannedTasks` 使用 progress 的非空可信值，否则为 `null`；
- runs 为所有已校验 trial attempts；
- 缺失或损坏的 ref 进入 diagnostics，且不参与分数。

final result 存在时：

- progress 存在时，其 trials 必须与 final trials 集合完全相等；没有 progress 的旧 eval 继续按 final-only 读取；
- 相同 trial 的 ref 必须字节语义相等；
- progress 多出 trial、identity 改写或 result 丢失已发布 trial时标记 `corrupt-eval`。

### 8.4 UI 语义

现有 `combinationScores()` 已能基于当前有效 task 计算 provisional score，应保留 task 等权、attempt 先求 task mean 的逻辑。

UI 增加/明确：

- running evaluation 显示“评测中”；
- partial score 旁显示“暂定”；
- coverage 在总数未知时显示 `N/?`；
- attempts 未齐时 task 行显示当前 attempts 数，不伪装为 settled comparison；
- baseline 或 candidate 单边出现时，delta/status 为 pending；
- 只有双方都有有效 observation 时才显示 improved/regressed/unchanged；
- partial runs 可以打开已完成的 canonical trajectory；
- 运行中的容器轨迹不可打开，因为未进入 sealed run store。

不需要修改 RPC endpoint 或 change payload。现有 `refinement/change -> controller.invalidate() -> resync()` 可复用。

## 9. 一致性、失败与恢复

| 场景 | 预期行为 |
| --- | --- |
| Gear attempt 已写，Hitch 尚未创建 eval | REAR 显示 queued/评测中；watch evals root，不报 corrupt |
| trial bundle 正在复制 | Hitch monitor 重试；REAR 不可见 |
| run 已 rename，progress 尚未写 | run 暂时为 orphan；REAR 不扫描猜测；final drain 可幂等恢复 |
| progress 已写 | 对应 run 必须已经存在且 sealed；REAR 刷新展示 |
| progress 指向缺失/identity 不符 run | REAR diagnostic，排除分数；Hitch finalization fail closed |
| Hitch 在第 N 个 trial 后崩溃 | 已发布 run/progress 保留；恢复/最终失败处理不得重写这些 refs |
| Harbor 失败 trial 没有 bundle | Hitch 生成 sealed diagnostic run，作为 invalid observation 展示 |
| Gear 进程崩溃但 Hitch 继续 | attempt ownership 已落盘，REAR 可继续展示；Gear 恢复策略另行决定，不自动晋升 |
| eval result 与 progress 冲突 | eval corrupt；不生成 final comparison |
| fs.watch 丢事件 | reconnect、Gear state change或后续 root change触发 authoritative rescan；不依赖 event payload 保存证据 |

Hitch 不在本 spec 中实现通用 eval resume。若进程崩溃后没有 terminal `result.json`，保留的 running progress 是诊断事实；后续可由 repair/finalize 命令封口，但 REAR 不自行把它改成 terminal。

## 10. 安全要求

- REAR 永不读取 Harbor job/staging 目录；
- progress 只接受 `EvalTrialRefV1`，不得携带任意文件路径；
- 所有 run path、trajectory ref、verifier ref 继续执行 realpath/symlink/escape 校验；
- bundle staging 和 final directory 必须同文件系统原子 rename；
- caller-provided eval ID 必须格式校验并独占创建；
- Gear ownership 只授权一个 exact eval，不授权按 benchmark、时间或目录前缀批量发现；
- partial score 不得进入 Gear selection/promotion；
- logs/events/progress 不新增 secret、绝对 workspace path 或原始 provider credential。

## 11. 兼容性与发布顺序

持久化兼容性：

- `progress.json` 是 Hitch additive artifact；旧 reader 忽略；
- Gear `evaluationAttempts` 是 optional round field；旧 rounds 保持可读；
- terminal `eval-result` schema version 仍为 `1`；
- REAR 对没有 progress/attempt 的数据继续整批展示。

推荐发布顺序：

1. **Hitch**：支持 `--eval-id`、progress、atomic bundle、incremental importer；
2. **REAR**：支持 Gear attempts 和 Hitch progress，同时保持旧路径；
3. **Gear**：启用 reservation/attempt 写入和 `--eval-id`。

Gear 不应在不支持 `--eval-id` 的 Hitch 版本上静默启用 reservation。版本组合由发布约束或明确 capability check 保证；不通过捕获未知参数错误后重跑 benchmark，因为重跑会产生重复成本和不清晰 ownership。

## 12. 文件级实施清单

### 12.1 `agent-hitch`

| 文件 | 改动 |
| --- | --- |
| `src/cli/commands/eval.ts` | `eval run --eval-id` |
| `src/evals/request.ts` | eval ID validator/reservation helper |
| `src/evals/service.ts` | 初始化/更新 progress、trial callback、final reconciliation |
| `src/evals/trial-import.ts` | 单 trial importer、幂等恢复、existing ref 验证 |
| `src/evals/progress.ts`（新增） | progress parse/build/merge/atomic write |
| `src/backends/harbor/backend.ts` | 子进程期间 trial monitor + final drain |
| `src/domain/eval-records.ts` | `EvalProgressV1` |
| `integrations/harbor/hitch_harbor_agent.py` | staging + marker + atomic bundle rename |
| `docs/schemas/eval-progress.schema.json`（新增） | JSON Schema |
| `docs/evals.md` | partial/final authority 和存储布局 |
| `test/evals.test.ts` | incremental、幂等、失败和 final equality |
| `test/cli.test.ts` | `--eval-id`、冲突和兼容性 |

### 12.2 `gear`

| 文件 | 改动 |
| --- | --- |
| `src/types.ts` | reservation、attempt state、evaluator optional contract |
| `src/evaluator/hitch-cli.ts` | reserve eval ID、传 `--eval-id`、校验 final identity |
| `src/refine/service.ts` | `evaluateWithAttempt`，所有四种 phase/owner 接入 |
| `src/state/store.ts` | attempt state 与 final evidence 一致性校验 |
| `tests/unit/hitch-cli-evaluator.spec.ts` | reservation/flag/mismatch |
| `tests/unit/refine-service.spec.ts` | running attempt 持久化、settled/failure 生命周期 |
| `tests/unit/state-store.spec.ts` | schema/identity/immutability validation |

### 12.3 `rear`

| 文件 | 改动 |
| --- | --- |
| `src/runtime.ts` | Gear attempts parser、partial association、final equality、early eval watch |
| `src/hitch-provider.ts` | progress parser、partial run projection、progress/result reconciliation |
| `src/types.ts` | 仅在现有 projection 不足时补充 provisional metadata；优先复用 `status/plannedTasks/settledTasks` |
| `src/client/RefinementView.tsx` | running/provisional/unknown coverage 语义 |
| `src/client/locales.ts` | “暂定”“进行中”等文案 |
| `tests/plugin/hitch-provider.spec.ts` | generation 0、逐 trial、corrupt、final transition |
| `tests/plugin/runtime.spec.ts` | attempt ownership、无 final evidence、final exact set |
| `tests/plugin/controller.spec.ts` | 连续 invalidation 后 UI state 更新 |
| `tests/plugin/benchmark-dashboard.spec.ts` | partial task/attempt 聚合和 pending comparison |

## 13. 测试方案

### 13.1 Hitch 单元/集成测试

1. 指定 eval ID 创建成功；重复 ID 返回 `eval_id_conflict` 且不修改旧目录；
2. Harbor fake process保持运行时写出 trial A result + complete bundle；断言 `runs/A` 和 progress A 在进程退出前出现；
3. 再写 trial B；progress generation 递增且 A ref 不变；
4. final drain 不重复导入 A/B；final result trial set 与 progress 完全相等；
5. progress 始终在 run rename 后可见；
6. partial JSON、缺 marker bundle 被重试，不生成早期 corrupt run；
7. 无 bundle 的 terminal trial生成 diagnostic run；
8. importer 在“run 已发布、progress 未写”的模拟崩溃点可以恢复；
9. duplicate trial/different run、duplicate run/different trial fail closed；
10. cancellation/Harbor failure 保留已发布 refs并写 terminal failed/cancelled result；
11. progress 和 final JSON 都通过 schema 校验；
12. bridge smoke test确认 REAR 永远不会观察到 final bundle path 的半复制状态。

### 13.2 Gear 测试

1. attempt 在 evaluator 开始前已经写入 round；
2. owner 对 seed baseline、seed candidate、held-out baseline、held-out candidate 正确；
3. evaluator resolve 后 attempt 和 evidence 在同一次状态更新中一致；
4. evaluator reject/cancel 后 attempt保留并 terminal；
5. returned eval ID 与 reservation 不同会 fail closed；
6. 无 `reserve()` 的 fake evaluator保持旧行为；
7. partial attempt 不触发 judges/selection/promotion；
8. restart 读取含 running/terminal attempts 的 round通过验证。

### 13.3 REAR 测试

1. 只有 Gear attempt、无 Hitch eval directory：queued，不报错；
2. generation 0：running、0 runs；
3. generation 1：一个 task/run立即出现，score provisional；
4. generation 2：同 task 第二 attempt按 task mean聚合；
5. baseline 单边完成时 delta pending；candidate 对应 task完成后产生比较；
6. progress identity/run parent/observation 任一不一致均排除；
7. result 出现后无闪烁、无重复 run，状态切 terminal；
8. progress/result mismatch 标记 corrupt；
9. final Gear evidence 到达后执行 exact run-set equality；
10. 连续 Hitch root 变更经过 debounce 后最终 snapshot不丢 generation；
11. 旧 final-only fixtures保持输出不变。

### 13.4 端到端验收

使用至少 3 tasks、`maxConcurrent > 1`、`attempts = 2` 的 benchmark：

- 保持 Hitch eval 进程运行；
- 第一个 trial terminal 后，验证 Hitch `result.json` 尚不存在；
- 验证 REAR 已出现该 task/attempt 和可打开的 sealed trajectory；
- 后续每个 trial 出现时 coverage/attempt count 单调增加；
- final result 出现后，REAR run IDs、分数、task mean 与一次性整批读取完全一致；
- Gear 的最终 promotion decision 与未启用增量展示时一致。

## 14. 验收标准

1. REAR 不再要求同一 eval 的整个 benchmark 完成后才显示首个任务；
2. 每个已完成且已封存 trial 只展示一次；
3. partial score 始终有 provisional 语义，不被 Gear 用于决策；
4. REAR 不读取或链接 Harbor staging；
5. Gear attempt 是 eval 进入 REAR 的必要 ownership 条件；
6. Hitch progress 与 run record 任一不一致都不会进入有效分数；
7. terminal result 保持 schema v1 和现有 CLI/programmatic consumer 兼容；
8. final Gear/Hitch run-set equality 不放宽；
9. cancellation、invalid observation 和 diagnostic run 均可增量显示但不伪造 reward；
10. 旧数据和不支持 incremental 的 evaluator 保持 final-only 展示；
11. 三个仓库的 typecheck、现有测试和本 spec 新增测试全部通过。

## 15. 明确拒绝的替代方案

### 15.1 REAR 直接扫描 `runs/*` 的 `parent.eval_id`

拒绝。Gear 在运行中没有记录该 eval ID 时，REAR 无法证明 eval 属于哪个 refine round/candidate；这会绕过 control-plane ownership。

### 15.2 运行中反复重写 `result.json`

拒绝。当前 result schema 是 terminal contract，status 只有 `succeeded/failed/cancelled`，下游也将它视为完整集合。partial 使用独立 progress artifact，避免改变 terminal 语义。

### 15.3 REAR 读取 Harbor trial result 或 bundle

拒绝。它们是 backend-specific staging，可能正在写入、包含机器路径且尚未通过 Hitch run-record/trajectory 完整性验证。

### 15.4 只增加前端轮询

拒绝。当前前端已经能在 invalidation 后 resync；没有 partial durable evidence 时，提高轮询频率不会产生可展示数据。
