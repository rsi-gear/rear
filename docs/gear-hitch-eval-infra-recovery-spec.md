# Gear / Hitch / REAR 指定 task 重跑实现 Spec

## 1. 目标

当一次 Hitch eval 因少量 task 的 observation invalid 或 task 缺失而失败时，允许用户显式补跑：

1. 当前 eval 中全部 invalid/missing task；或
2. 用户按 task name 指定的 invalid/missing task。

重跑沿用原 `eval_id` 和冻结的执行配置。已 valid task 不执行、不替换，reward 不加 penalty，也不重新聚合成别的语义。

本方案不修改 Harbor/Hitch 的 timeout 机制，不做 infra 错误分类、自动重试、暂停/续传或跨进程 recovery 状态机。Gear 只把新 evolution 的默认单 task 预算提高到 60 分钟，并提供人工触发的 task 重跑入口。

## 2. 用户接口

### Hitch

```bash
hitch eval rerun <eval-id> --invalid --output json

hitch eval rerun <eval-id> \
  --task task-a \
  --task task-b \
  --output json
```

约束：

- `--invalid` 与 `--task` 必须且只能选择一种；
- `--task` 可重复；
- 指定 task 必须属于原 plan，且当前不是 valid；
- cancelled eval 不允许重跑；
- 同一 eval 同时只允许一个 rerun；
- 当前实现只支持冻结的本地 task plan 且 `attempts=1`。

### Gear

```text
/refine rerun <evolution-id> <round-id> --eval <eval-id> --invalid

/refine rerun <evolution-id> <round-id> --eval <eval-id> \
  --task task-a --task task-b
```

Gear 只允许重跑该 failed round 持有的 failed Hitch attempt。用户不能在重跑时更换 dataset、model、harness、timeout 或 condition。

## 3. Valid 与 invalid

task 当前状态由 Hitch `progress.json` 的 `(task_id, attempt=1)` slot 决定：

- observation 为 `valid`：不可重跑；reward 可以是 `0`；
- observation 为 `invalid`：可以重跑；
- task 在冻结 plan 中但 progress 缺失：可以重跑。

因此 agent timeout 后 verifier 若仍产生合法 reward（包括 `0`），不会进入重跑集合。

## 4. Hitch 实现

### 4.1 冻结身份

重跑从原 eval 的持久化文件恢复：

- `request.json`：dataset、model、timeout、setup timeout、环境策略；
- `plan.json`：task names、candidate、prepared artifact、controller runtime；
- `resolution.json`：不可变 harness revision；
- `progress.json`：当前 task membership。

这些身份在启动 Harbor 前重新校验。重跑不接受覆盖参数。

### 4.2 Harbor 过滤

Hitch 为本次 rerun 生成独立 Harbor backend 目录，并在 Harbor dataset config 中写入选中的 `task_names`。未选 task 不进入本次 Harbor job。

### 4.3 逐 task 发布

每个选中 task 完成后：

1. 导入并校验新的 run bundle；
2. 只有 observation 为 valid 才能替换 membership；
3. 原子更新顶层 `progress.json`；
4. invalid 重跑结果仅保留在 rerun/Harbor 审计目录，不覆盖原 slot。

替换规则：

- old valid：禁止替换；
- old invalid：只可替换为 new valid；
- old missing：只可填入 new valid；
- 其他 task 的 trial ref、run id、reward 保持原值。

### 4.4 完成

Harbor invocation 正常结束后，根据最新 progress 重建顶层 `result.json`：

- 所有 planned task valid：eval `succeeded`；
- 仍有 invalid/missing：eval `failed`，返回 `remaining_invalid_tasks`。

Hitch CLI 的 JSON 输出是独立 rerun envelope：

```json
{
  "schema_version": "1",
  "kind": "eval-rerun",
  "rerun_id": "rerun_...",
  "eval_id": "eval_...",
  "status": "completed",
  "selected_tasks": ["task-b"],
  "repaired_tasks": ["task-b"],
  "remaining_invalid_tasks": [],
  "eval_status": "succeeded"
}
```

每次 invocation 写入：

```text
evals/<eval-id>/reruns/rerun_<id>/
  request.json
  state.json
  harbor/
```

该目录只用于本次执行隔离、审计和 REAR 展示 `rerunning`；不是续传状态机。

## 5. Gear 实现

### 5.1 默认预算

`taskBudgetMs` 默认值从 5 分钟提高到 60 分钟（`3_600_000`）。显式配置和 `/refine ... --budget` 仍优先。

### 5.2 状态

新增：

- round status：`repairing-evaluation`；
- evaluation attempt status：`rerunning`。

流程：

1. 校验 evolution、failed round、eval ownership 和 Hitch provider；
2. 将原 attempt 标为 `rerunning`，round 标为 `repairing-evaluation`；
3. 调用 Hitch `eval rerun`；
4. 若仍有 invalid task，恢复 failed 状态并保留同一 eval id；
5. 若 eval succeeded，执行 `hitch eval inspect` 读取完整 evidence；
6. 严格校验 provider、eval、condition、dataset、commit ownership；
7. 将同一 attempt 标为 settled，并从该 round 的已落盘阶段继续执行。

不会创建新的 Gear evaluation attempt，也不会把补跑次数计入 benchmark attempts。

## 6. REAR 实现

REAR 增加 `rerunning` projection，并识别：

- Gear round `repairing-evaluation`；
- Gear attempt `rerunning`；
- Hitch `reruns/rerun_<id>/state.json` 中的 active rerun。

rerun active 时，旧 `result.json` 可能落后于刚更新的 progress，因此：

- `progress.json` 是当前 task membership；
- 每次 progress 原子替换都会触发 eval watch 和客户端刷新；
- 已 valid task 和 reward 继续展示；
- 新修复 task 在发布后立即出现，不等待整次 rerun 完成；
- comparison/portfolio 在 rerun 结束前保持 provisional/pending。

rerun 完成且 Gear attempt settled 后，REAR 恢复使用相互一致的 terminal result/progress。

## 7. Reward 不变量

1. valid reward（包括 `0`）不触发 rerun。
2. 未选中的 valid task 的 trial ref、run id、reward 不变。
3. invalid/missing slot 只有在新 observation valid 后才替换。
4. 新 reward 直接采用 verifier reward。
5. 不按 rerun 次数扣分，不把 infra invalid 变成 `0`，不平均新旧 invalid/valid 结果。
6. rerun 再次 invalid 或执行失败时，当前有效 membership 不回退。

## 8. 验收

- `--invalid` 只向 Harbor 传入当前 invalid/missing task。
- repeated `--task` 只传入指定 task。
- 指定 valid/unknown task 明确失败。
- 一个 invalid task 修复后，同一 eval 的其他 valid reward 和 run id 不变。
- rerun 中每发布一个 valid task，REAR 即更新 task coverage/reward。
- Gear 在修复成功后沿同一 round/eval id 继续。
- 默认 task budget 为 60 分钟。
- Hitch、Gear、REAR 类型检查与相关回归测试通过。
