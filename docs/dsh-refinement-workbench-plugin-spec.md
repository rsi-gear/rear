# Gear 实验只读工作台规格

- 状态：Implemented
- 日期：2026-08-25
- 目标宿主：DeepSeek Harness Web
- 实验事实源：Gear evolution state
- 运行与轨迹事实源：Hitch run-centered storage

## 1. 结论

Rear 是 Gear 实验的只读可观测界面，不是 refinement 执行器。

Gear 独占 `/refine`、实验生命周期、候选生成、测评调度与 promotion。Rear 不注册 `/refine`，不读取命令返回，不保存 refinement sidecar，不取消实验，也不改写 Gear 或 Hitch 数据。

Rear 只消费已经落盘的关联：

```text
Gear registry.json
  └─ evolutionId
      └─ evolutions/<evolutionId>/rounds/<roundId>.json
          └─ evaluation evidence: evalId + trials[*].runId
              └─ Hitch evals/<evalId>/result.json
                  └─ trials[*].run_id
                      └─ runs/<runId>/manifest.json
                          └─ trajectory_ref
                              └─ TrajectoryRef V2 canonical_session
```

因此 Rear 与 Gear 的集成接口是 Gear 的持久化状态格式，不是 `/refine` 的同步返回值。

## 2. 所有权边界

| 事实或动作 | 所有者 | Rear 行为 |
| --- | --- | --- |
| `/refine` 命令与返回值 | Gear | 不注册、不调用、不解析 |
| evolution、round、candidate、promotion | Gear | 从 `evolutionState.stateRoot` 只读投影 |
| eval 与 run 的成员关系 | Gear + Hitch | 双向严格校验，不一致即拒绝 |
| benchmark、task、trial、attempt | Hitch | 读取权威值并与 Gear 证据核对 |
| run manifest 与 `trajectory_ref` | Hitch | 按引用解析，不猜测文件名 |
| 轨迹文件内容、大小与校验和 | Hitch | 逐项验证后按需返回 |
| 创建、取消或修改实验 | Gear | Rear 不提供写入口 |

## 3. Gear 发现契约

配置项 `gear.root` 必须等于 Gear 的 `evolutionState.stateRoot`，且必须是已存在的绝对真实目录。

Rear 读取：

```text
<gear.root>/registry.json
<gear.root>/evolutions/<evolutionId>/rounds/*.json
```

实现要求：

1. `registry.json` 必须为 Gear registry schema version 1，evolution ID 唯一且为安全路径标识。
2. round 文件名必须等于文件内 `roundId`，文件内 `evolutionId` 必须等于所属目录。
3. 不跟随作为根、round 目录或 JSON 文件出现的符号链接；realpath 必须位于配置根内。
4. 只投影 Gear 已经写出的数据。trial 没有 `runId` 时，不为该 evaluation 暴露轨迹引用。
5. Gear 状态变化只触发浏览器重新读取；Rear 不缓存第二份持久化实验状态。

Gear evolution 在 Rear 中投影为 `gear-evolution:<evolutionId>`，round 投影为 `gear-round:<roundId>`，candidate 投影为 `gear-candidate:<candidateId>`。这些前缀只属于 Rear 的 UI 兼容模型，不写回 Gear。

## 4. Gear 到 Hitch 的严格关联

对于 Gear evidence 中含 `runId` 的 evaluation，Rear 必须读取对应的 Hitch `evals/<evalId>/result.json`，并验证：

1. `schema_version` 与 `eval_id` 正确；
2. Hitch eval 提供非空 `benchmark_id` 与 `benchmark_revision`；
3. Gear run ID 集合与 Hitch trial `run_id` 集合完全相等；
4. 每个 run 的 `trial_id`、`task_id` 与 `attempt` 和 Gear 证据一致；
5. 后续读取 run 时，Hitch run manifest 的 parent eval/trial/attempt、benchmark context 和 observation 与 eval result 一致。

集合校验必须是完全相等，而不是“请求的 run 恰好存在”。这样不能把同一 eval 之外的 run 注入某个 Gear 实验，也不能在 Gear 只记录部分 run 时悄悄显示不完整结果。

任何身份不一致都应 fail closed，不得从路径、目录顺序、task 名或最新时间猜测关联。

## 5. 轨迹解析

Rear 从 Hitch run manifest 的 `trajectory_ref` 字段寻找 TrajectoryRef V2。禁止默认拼接固定轨迹文件名。

解析要求：

1. `trajectory_ref` 必须留在该 run 目录内；
2. ref 的 `schema_version` 与 `run_id` 必须正确；
3. `canonical_session` 文件必须是 ref 明确列出的文件；
4. 文件必须为普通文件，realpath 不得逃逸 Hitch 根或 run 根；
5. 实际 byte count 与 SHA-256 必须等于 ref；
6. canonical NDJSON 必须满足 DSH Session version 0 结构；
7. provider 原生证据只能通过有上限的分页接口读取。

## 6. Host 与 Client

Host 暴露只读 RPC：experiment list/detail、evaluation projection、trajectory、provider evidence 和 change wait。不存在 start、cancel 或 `/refine` endpoint。

Client 注册一个 `Refine` conversation view。每个 DSH Session 拥有独立 controller 状态，但所有有效 Session 看到相同的 Gear 持久化 experiment 列表；Session 不再承担 experiment ownership。

Gear 或 Hitch 文件变化时，Host 只发送无证据 payload 的 invalidation。Client 随后重新读取权威数据。新 evolution 的 invalidation 也必须触发 list resync，即使它尚未出现在当前 controller 中。

## 7. 配置

```ts
interface Config {
  gear: {
    root: string
    watchDebounceMs: number
  }
  hitch: {
    id: string
    root: string
    watchDebounceMs: number
  }
  trajectoryResponseMaxBytes: number
  providerEvidencePageMaxBytes: number
  changeWaitMs: number
}
```

所有路径与上限必须显式配置。安装 bundle 仅加入 dormant Loader row，不应因为安装包而开始扫描本地文件系统。

## 8. 验收条件

1. Rear 源码和组合测试均不注册 `/refine`。
2. Rear 不依赖 Gear 命令返回、DSH storage sidecar 或 refinement driver。
3. 一个合法 Gear round 能解析到其 Hitch canonical trajectory。
4. 伪造或错配的 Gear run ID 因 Gear/Hitch 成员集合不一致而失败。
5. 轨迹路径逃逸、symlink、大小或 SHA-256 不一致时失败。
6. Gear 与 Hitch 根变化后 Client 执行权威重同步。
7. Gear 仓库不需要任何修改。
