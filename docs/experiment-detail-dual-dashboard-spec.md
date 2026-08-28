# Gear 实验明细双表格规格

- 状态：Implemented
- 日期：2026-08-28
- 目标仓库：`rear`
- 实验事实源：Gear evolution / round / candidate state
- 评测、运行与轨迹事实源：Hitch eval / run-centered storage
- Gear 数据契约：当前本地 Gear 版本的结构化 round schema

## 1. 结论

实验明细页只保留两张核心表格：

1. **Benchmark 组合表**：列出跨迭代的实验组合，回答“当前最好的实验组合是什么”；
2. **Task 对比表**：通过 Harness、Model 和 Benchmark 选择，把匹配组合的 task 表现放在同一张表中，选择 2–4 条轨迹进入轨迹对比。

迭代不再是 Tab，也不再拥有独立看板。迭代编号、方向摘要和状态直接作为实验组合的字段展示。

```text
实验标题
  ├─ Benchmark 组合表
  │    └─ 选择或筛选 Harness / Model
  └─ Task 对比表
       └─ 选择 Benchmark + Harness / Model
           └─ 在同一 task 行选择 2–4 条轨迹
               └─ 轨迹对比页
```

## 2. 目标与非目标

### 2.1 目标

- 用一张普通表格展示、筛选和排序所有 Benchmark 实验组合；
- 明确展示每个组合来自哪个迭代，以及该轮的方向摘要；
- 用 Harness / Model 选择自然表达“固定 Model 对比 Harness”或“固定 Harness 对比 Model”；
- 将匹配组合的 task 得分按列对齐，快速发现差异；
- 直接从 task 得分单元格选择具体轨迹；
- 保留运行身份、coverage、partial、失败和轨迹可用性等必要语义；
- 复用现有只读 Gear/Hitch 数据和轨迹对比能力。

### 2.2 非目标

- 不使用迭代 Tab；
- 不提供独立迭代方向卡片、时间线或迭代详情页；
- 不提供 Pareto 图、统计卡片或独立回归面板；
- 不提供“固定 Model / 固定 Harness”模式开关；
- 不在 Rear 中创建、取消、重跑或修改 Gear 实验；
- 不重新设计轨迹内容本身的渲染方式。

## 3. 基本概念

### 3.1 实验组合行

Benchmark 组合表的一行代表一次可追溯的组合评测：

```text
iteration
  × candidate
  × Harness identity
  × Model identity
  × comparison-relevant Protocol identity
```

同一 Harness × Model 在不同迭代重复评测时保留为不同的行，不能挑选历史最高值后合并。这样迭代方向、运行状态和评测结果始终一一对应。

“重复评测”要求存在新的 eval / run 证据。如果后续迭代只是复用上一轮完全相同的 eval ID 和 run set，则只展示首次产生该证据的组合行，不能把同一批 task 得分复制成新的迭代列。没有产生可用 eval 的候选作为失败行展示方向和失败原因，但不能带入 Task 对比。

Harness、Model 和 Protocol 使用有效身份分组：

- Harness 至少使用 `harness_id + revision_identity`；
- Model 使用 `provider + effective_id`，未解析时明确标记；
- Protocol 排除 `initial_workspace_digest` 等随 task 固有变化的 fixture 字段，但保留 timeout、workspace mode 和 environment identity 等可比性字段；
- 显示名称相同但有效身份不同的组合必须拆行。

### 3.2 Benchmark 与 task

```text
benchmark key = (benchmark_id, benchmark_revision)
task key      = (benchmark_id, benchmark_revision,
                 task_id, task_digest, verifier_identity)
```

Benchmark 组合表按 benchmark key 展示聚合分数。Task 对比表只把完整 task key 相同的运行放在同一行。

### 3.3 Run 与轨迹

一个 task 得分单元格可以包含一个或多个 attempts。单元格展示 task mean；真正进入轨迹对比时选择的是具体 run / attempt。

### 3.4 Gear 数据契约

Rear 只消费当前本地 Gear 写入的结构化字段：

- `evaluationAttempts` 提供 eval、owner、phase、Harness、Model 和 lifecycle；
- `evaluationRepairResume` 与 `repair-completed` 共同表示已修复且可以读取的持久化 evidence；
- `failedEvaluations` 提供失败评测的完整 run membership；
- candidate `proposal.expectedOutcome / rationale` 提供迭代方向摘要；
- `seedEvaluation / heldOutEvaluation / evaluation` 提供 Gear 已确认的最终评测证据。

Rear 不从 failure message 中解析 eval ID，不推断缺失的 attempt ownership，也不为旧版 Gear round schema 生成虚构列。复用历史 baseline 时，以 `reusedFromRoundId` 和相同 eval/run evidence 为准去重；新的 eval/run evidence 必须形成独立组合行和 Task 列。

## 4. 页面结构

实验明细页从上到下只包含：

1. 实验标题、整体状态、最近更新时间；
2. evolution 级错误；
3. Benchmark 组合表；
4. Task 对比表。

轨迹对比作为进入后的独立页面层级。

迭代级、candidate 级和 eval 级失败显示在对应表格行或列中，不显示成全局错误横幅。

## 5. Benchmark 组合表

### 5.1 回答的问题

**当前最好的完整实验组合是什么？**

### 5.2 筛选

表格顶部只有两个筛选器：

```text
Harness [全部 / 一个或多个身份]
Model   [全部 / 一个或多个身份]
```

两个筛选器仅过滤表格行，不改变数据聚合语义。默认均为“全部”。单选项时隐藏对应筛选器。

### 5.3 表格列

| 列 | 内容 |
| --- | --- |
| 排名 | 当前排序下的序号 |
| 迭代 / 方向 | `迭代 01` 加一句话方向摘要 |
| 状态 | 完整、暂定、失败、身份未解析 |
| Harness | Harness ID 与 revision 短摘要 |
| Model | provider 与 effective model ID |
| Benchmark 分数 | 每个 benchmark key 一列 |
| 等权平均 | 可用 Benchmark 分数的等权平均 |
| Coverage | 单 Benchmark 显示 task coverage；多 Benchmark 显示 Benchmark coverage |
| 平均差值 | 相对对应 baseline 的平均差值 |
| 操作 | 带入 Task 对比表 |

回归红线和平均延迟如需保留，应作为普通可排序列，不再单独渲染统计卡片。

### 5.4 迭代方向摘要

方向摘要只占“迭代 / 方向”一列，最多展示一句主摘要。完整内容可以通过行展开或 title 查看。

事实源优先级：

1. 当前 Gear candidate `proposal.expectedOutcome`；
2. 当前 Gear candidate `proposal.rationale`；
3. 没有权威文本时显示“暂无方向摘要”。

不得在浏览器加载时临时调用模型生成方向。失败迭代在本列或状态列显示权威失败原因。

### 5.5 分数

```text
task mean = 同一 task 的所有有效 attempts reward 算术平均
benchmark score = 所有有效 task mean 的算术平均
equal-weight mean = 所有可用 Benchmark score 的算术平均
```

规则：

- task 等权，不允许 attempts 多的 task 获得更高权重；
- reward `0` 是有效观测；
- invalid、corrupt、missing ownership 和 failed Gear evidence 不进入分数；
- task-specific `initial_workspace_digest` 不得拆分同一组合中的 tasks；
- running evaluation 显示 partial score 和 `N/总数`，同时标记“暂定”；
- 同一组合在不同迭代重复评测时保留独立行；
- Baseline 作为普通组合参与排序。

### 5.6 默认排序

默认顺序：

1. 完整结果优先于暂定和失败结果；
2. coverage 完整优先；
3. 等权平均得分降序；
4. 平均延迟升序；
5. 迭代时间降序。

排序后的第一条完整行就是“当前最佳实验组合”。partial 行不能覆盖已有完整最佳结果。

用户可以点击普通表头重新排序，不提供额外排序面板。

### 5.7 行操作

点击“带入对比”后：

- 将该行的 Harness、Model 和可用 Benchmark 带入 Task 对比表；
- 该组合成为 Task 对比表的默认参考列；
- 页面滚动到 Task 对比表；
- 不跳转到新的迭代页面。

## 6. Task 对比表

### 6.1 回答的问题

**指定 Harness / Model 后，各个 task 的表现有什么差异，哪些轨迹值得打开对比？**

### 6.2 选择器

表格顶部只有三个选择器：

```text
Benchmark [单选]
Harness   [单选或多选]
Model     [单选或多选]
```

只有一个 Benchmark 时隐藏 Benchmark 选择器。

控制变量规则：

- 一个 Model + 多个 Harness：固定 Model，对比 Harness；
- 一个 Harness + 多个 Model：固定 Harness，对比 Model；
- 一个 Harness + 一个 Model：查看该组合跨迭代或 attempts 的 task 表现；
- Harness 和 Model 同时多选时不渲染结果，提示用户固定其中一个维度。

因此不需要额外的“固定 Harness / 固定 Model”模式开关。

从 Benchmark 组合表带入一行时，先填入该行的 Harness 与 Model。用户再把想比较的维度扩展为多选。

### 6.3 表格方向

- 行：完整 task key；
- 列：所有匹配 Harness / Model 选择的实验组合行；
- 列头：迭代、方向短摘要、Harness、Model 和完整/暂定状态；
- 单元格：task mean、attempt 数、相对参考列差值和轨迹可用性。

示例：

| Task | 迭代 01 · h1 × m1 | 迭代 02 · h2 × m1 | 差值 |
| --- | ---: | ---: | ---: |
| build-cython-ext | 1.000 | 1.000 | 0.000 |
| chess-best-move | 1.000 | 0.000 | -1.000 |
| configure-git-webserver | 0.000 | 1.000 | +1.000 |

当只展示两个组合列时显示相对参考列的 delta。展示三个及以上组合列时，用 `max(task mean) - min(task mean)` 作为“差异”列。

### 6.4 Task 排序

默认按差异绝对值降序，让表现差异最大的 task 排在前面。

表头支持：

- task 名称；
- 每个组合的 task mean；
- 差异；
- trajectory availability。

不提供独立的排序策略面板。

### 6.5 轨迹选择

每个得分单元格都是一个轨迹选择入口：

- 没有可用 trajectory 时禁用，并显示原因；
- 同一个 run ID 在矩阵中最多出现为一个可选择证据，复用同一 eval/run set 的迭代不得生成重复列；
- 只有一个可用 run 时，点击直接选中或取消；
- 有多个 attempts 时，点击后显示简短 attempt 列表，用户选择具体 run；
- 已选中单元格显示明确的选中状态；
- 用户只能在同一个 task 行选择轨迹；
- 选择新的 task 行时清空旧行选择；
- 最少选择 2 条、最多选择 4 条轨迹。

表格底部或粘性操作区只显示：

```text
已选择 N 条轨迹    [进入轨迹对比]
```

按钮不可用时紧邻显示原因。

### 6.6 可比性

UI 保持简单，但不能放宽事实约束。进入轨迹对比前必须验证：

- run 属于当前 Gear evolution；
- run 具有相同完整 task key；
- trajectory 可用；
- 固定 Model 场景下 Model 与 comparison-relevant Protocol identity 相同；
- 固定 Harness 场景下 Harness 与 comparison-relevant Protocol identity 相同。

兼容性检查由 Host 使用 Gear/Hitch 权威数据完成。现有接口不足以验证跨迭代 run 时，可以增加一个最小的只读检查请求；该技术细节不在页面增加新的交互步骤。

严格不可比的单元格默认不能选择，并展示简短 exclusion reason。本规格不提供 exploratory compare 入口。

## 7. 轨迹对比页

轨迹对比页复用现有 native DSH offline trajectory surface：

- 2–4 条 lane；
- 第一条已选轨迹作为参考列；
- lane header 显示 Harness、Model、迭代、attempt、reward 和 duration；
- 返回后保留 Benchmark、Harness、Model、task 和轨迹选择；
- missing、corrupt 或 unsupported trajectory 不渲染成空白成功 lane。

## 8. 状态与实时刷新

- 页面加载 active iteration 和全部历史 iteration；
- 历史结果到达时增量增加或更新组合行和 task 列；
- 已有完整最佳组合在刷新期间保持可见；
- running 结果始终标记“暂定”；
- active iteration 没有有效 run 时不能把全局最高分清零；
- iteration、candidate、eval 和 run failure 显示在对应行、列或单元格；
- 一个历史 evaluation 读取失败不能隐藏其他有效数据；
- 当前筛选对应的数据消失或身份变化时，清理失效的轨迹选择。

## 9. Client 改动

实验明细页不再使用 `selectedIterationId` 控制整页数据。`evaluationHistory` 继续按 iteration ID 保存 projection，两张表都从全部已加载数据派生。

建议保留以下页面状态：

```ts
interface ExperimentDetailTableState {
  combinationHarnessFilter: readonly string[]
  combinationModelFilter: readonly string[]
  selectedBenchmarkKey: string | null
  selectedHarnessIds: readonly string[]
  selectedModelIds: readonly string[]
  referenceCombinationKey: string | null
  selectedTaskKey: string | null
  selectedRunIds: readonly HitchRunId[]
}
```

需要保持为纯函数并单独测试：

- iteration × Harness × Model 组合行派生；
- protocol identity 规范化；
- task mean、Benchmark score 和等权平均；
- 完整 / 暂定排序；
- Harness / Model 选择到组合列的过滤；
- task 差异计算与排序；
- run 可选性与选择失效规则。

## 10. 视觉与交互规则

- 两张表使用相同的表头、筛选器、排序和状态样式；
- 不在表格上方重复 KPI 卡片；
- 第一列固定，宽表允许横向滚动；
- 不通过缩小字体把全部组合强行塞入一屏；
- 完整、暂定、失败和不可选同时使用文字，不只依赖颜色；
- 长 identity 显示短摘要，完整值放在 title 或行展开内容中；
- selector、排序、单元格选择和对比按钮支持键盘操作；
- 单选项 selector 隐藏；
- 所有文案使用 locale key，不在组件中散落硬编码中文。

## 11. 实现步骤

### 阶段一：Benchmark 组合表

1. 删除迭代 Tab、方向卡片、统计卡片和 Pareto 面板；
2. 按 iteration × combination 生成普通表格行；
3. 增加迭代方向列、Harness / Model 筛选和表头排序；
4. 修正完整 / partial、coverage、baseline 和最佳组合规则；
5. 增加“带入对比”操作。

### 阶段二：Task 对比表

1. 增加 Benchmark、Harness 和 Model 选择器；
2. 按 task 行、组合列构建得分矩阵；
3. 增加差异计算、表头排序和 attempt 选择；
4. 支持同行选择 2–4 条轨迹；
5. 增加跨迭代 run 兼容性检查；
6. 接入现有轨迹对比页并保留返回状态。

## 12. 测试要求

### 12.1 数据与聚合

- 不同迭代的同一 Harness × Model 保留不同组合行；
- task-specific `initial_workspace_digest` 不拆分同一行中的 tasks；
- 不同 Harness revision、effective model 或 comparison protocol 拆行；
- repeated attempts 先计算 task mean；
- reward `0` 正常进入分数；
- partial 行不覆盖完整最佳行；
- 单 Benchmark coverage 显示 `5/5`。

### 12.2 筛选与表格

- Benchmark 组合表 Harness / Model 筛选只改变可见行；
- 一个 Model + 多个 Harness 正确生成 Harness 对比列；
- 一个 Harness + 多个 Model 正确生成 Model 对比列；
- Harness 与 Model 同时多选时显示固定维度提示；
- 相同 task key 正确对齐；
- 两列时计算 delta，多列时计算 score range；
- 默认按差异绝对值排序。

### 12.3 轨迹选择

- 只有可用轨迹的单元格可以选择；
- 多 attempt 可以选择具体 run；
- 不能跨 task 行选择；
- 选择数量限制为 2–4；
- identity 不兼容时禁止进入对比并显示原因；
- 返回 Task 对比表后恢复有效选择。

### 12.4 UI

- 页面没有迭代 Tab、独立方向卡片、Pareto 或 KPI 卡片；
- 两张表同时可见并使用一致交互；
- iteration failure 出现在对应组合行；
- 360px、736px 和桌面宽度下操作可达、文字不重叠；
- 表格横向滚动时 Task / 组合身份列保持可见。

## 13. 验收条件

1. 实验明细页的主要内容只有 Benchmark 组合表和 Task 对比表；
2. Benchmark 组合表默认列出全部迭代的组合行，并明确当前最佳完整组合；
3. 每个组合行展示迭代编号和一句方向摘要；
4. 用户可以用 Harness / Model 筛选组合表；
5. 用户可以用一个固定维度和一个可变维度生成 Task 对比列；
6. Task 表把相同完整 task key 的表现对齐在同一行；
7. 用户可以在同一 task 行选择 2–4 条具体轨迹；
8. 合法选择可以进入现有轨迹对比页；
9. partial、failed、invalid、corrupt 和 missing trajectory 保持准确语义；
10. Rear 仍是 Gear/Hitch 的只读观察界面。
