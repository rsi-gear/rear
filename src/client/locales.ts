/** Refinement workbench copy keys. */
export type RefinementKey =
  | 'view.refinement' | 'empty.title' | 'empty.body' | 'loading' | 'unknown'
  | 'overview.title' | 'evaluation.title' | 'comparison.title' | 'back'
  | 'evaluation.failedEvidence'
  | 'status' | 'objective' | 'iterations' | 'open' | 'strict' | 'exploratory'
  | 'task' | 'baseline' | 'candidate' | 'delta' | 'state' | 'compare'
  | 'attempts' | 'evidence.raw' | 'evidence.hide' | 'evidence.canonical' | 'unpaired'
  | 'evidence.next' | 'dimension.harness' | 'dimension.model' | 'runs'
  | 'overview.kicker' | 'overview.bestScore' | 'overview.leadingCombination'
  | 'overview.harnessVersion' | 'overview.benchmarkVersion' | 'overview.openBreakdown'
  | 'overview.noScore' | 'overview.history' | 'overview.updated' | 'overview.provisional'
  | 'portfolio.kicker' | 'portfolio.dashboard' | 'portfolio.title' | 'portfolio.benchmarks'
  | 'portfolio.guardrails' | 'portfolio.guardrailHint' | 'portfolio.leadingDelta'
  | 'portfolio.candidate' | 'portfolio.meanReward' | 'portfolio.meanDelta'
  | 'portfolio.pareto' | 'portfolio.tradeoff' | 'portfolio.paretoTitle'
  | 'portfolio.latency' | 'portfolio.paretoHint' | 'portfolio.noData'
  | 'portfolio.selectedBenchmark'
  | 'breakdown.kicker' | 'breakdown.experiments' | 'breakdown.tasks'
  | 'breakdown.validRuns' | 'breakdown.taskCoverage' | 'breakdown.score'
  | 'breakdown.noScore' | 'breakdown.noTasks' | 'breakdown.iteration' | 'breakdown.all'
  | 'breakdown.improved' | 'breakdown.regressed' | 'breakdown.unchanged'
  | 'comparison.chooseRuns' | 'comparison.chooseHint' | 'comparison.reward'
  | 'comparison.duration' | 'comparison.tools' | 'comparison.tokens' | 'comparison.ttft'
  | 'comparison.eval' | 'comparison.trial' | 'comparison.protocol' | 'comparison.invalid'
  | 'trajectory.empty' | 'breakdown.best'
  | 'table.combinationTitle' | 'table.combinationHint' | 'table.taskTitle' | 'table.taskHint'
  | 'table.rank' | 'table.iterationDirection' | 'table.noDirection' | 'table.coverage'
  | 'table.operation' | 'table.bringToCompare' | 'table.benchmark' | 'table.harnessFilter'
  | 'table.modelFilter' | 'table.all' | 'table.statusComplete' | 'table.statusProvisional'
  | 'table.statusUnresolved' | 'table.fixedDimension' | 'table.difference'
  | 'table.selectedTrajectories' | 'table.enterComparison' | 'table.chooseAttempt'
  | 'table.noMatchingCombinations' | 'table.selectionHelp' | 'table.candidate'
  | 'table.noTaskData'
  | 'status.queued' | 'status.preparing' | 'status.evaluating' | 'status.settled'
  | 'status.running' | 'status.rerunning' | 'status.awaitingReview' | 'status.completed' | 'status.succeeded'
  | 'status.failed' | 'status.timedOut' | 'status.cancelled' | 'status.corrupt'
  | 'status.pending' | 'status.regressed' | 'status.invalid' | 'status.improved'
  | 'status.unchanged' | 'status.valid' | 'status.missing'

/** English refinement workbench dictionary. */
export const en: Record<RefinementKey, string> = {
  'view.refinement': 'Refine',
  'empty.title': 'No Gear evolutions yet',
  'empty.body': 'No persisted experiments were found under the configured Gear state root.',
  loading: 'Loading…', unknown: 'Unknown',
  'overview.title': 'Refinement overview', 'evaluation.title': 'Iteration evaluation',
  'evaluation.failedEvidence': 'Failed evaluation',
  'comparison.title': 'Task trajectory comparison', back: 'Back',
  status: 'Status', objective: 'Objective', iterations: 'Iterations', open: 'Open',
  strict: 'Strict comparison', exploratory: 'Exploratory comparison', task: 'Task',
  baseline: 'Baseline', candidate: 'Candidate', delta: 'Delta', state: 'State',
  compare: 'Compare trajectories', attempts: 'attempts', 'evidence.raw': 'Raw evidence',
  'evidence.hide': 'Hide raw evidence',
  'evidence.canonical': 'Canonical trajectory', unpaired: 'Unpaired attempts',
  'evidence.next': 'Next raw trajectory page', 'dimension.harness': 'Harness',
  'dimension.model': 'Model', runs: 'Runs',
  'overview.kicker': 'Active benchmark', 'overview.bestScore': 'Best score',
  'overview.leadingCombination': 'Leading combination', 'overview.harnessVersion': 'Harness version',
  'overview.benchmarkVersion': 'Benchmark version', 'overview.openBreakdown': 'Open breakdown',
  'overview.noScore': 'Waiting for valid observations', 'overview.history': 'Refinement history',
  'overview.updated': 'Updated', 'overview.provisional': 'Provisional',
  'portfolio.kicker': 'Multi-objective evaluation', 'portfolio.dashboard': 'Benchmark portfolio',
  'portfolio.title': 'Benchmark portfolio', 'portfolio.benchmarks': 'Benchmarks',
  'portfolio.guardrails': 'Guardrails passed', 'portfolio.guardrailHint': 'Regression limit',
  'portfolio.leadingDelta': 'Leading mean delta', 'portfolio.candidate': 'Candidate',
  'portfolio.meanReward': 'Equal-weight mean', 'portfolio.meanDelta': 'Mean Δ',
  'portfolio.pareto': 'Pareto', 'portfolio.tradeoff': 'Quality × latency',
  'portfolio.paretoTitle': 'Trade-off frontier', 'portfolio.latency': 'Mean latency',
  'portfolio.paretoHint': 'Outlined points are on the Pareto frontier',
  'portfolio.noData': 'Benchmark results will appear as evaluations settle',
  'portfolio.selectedBenchmark': 'Selected benchmark',
  'breakdown.kicker': 'Experiment breakdown', 'breakdown.experiments': 'Experiment directions',
  'breakdown.tasks': 'Task results', 'breakdown.validRuns': 'Valid runs',
  'breakdown.taskCoverage': 'Task coverage', 'breakdown.score': 'Score',
  'breakdown.noScore': 'No valid score', 'breakdown.noTasks': 'Task results will appear as evaluations settle',
  'breakdown.iteration': 'Iteration', 'breakdown.all': 'All', 'breakdown.improved': 'Improved',
  'breakdown.regressed': 'Regressed', 'breakdown.unchanged': 'Unchanged',
  'breakdown.best': 'Best',
  'comparison.chooseRuns': 'Choose trajectories', 'comparison.chooseHint': 'Select 1–4 runs from the same task',
  'comparison.reward': 'Reward', 'comparison.duration': 'Duration', 'comparison.tools': 'Tools',
  'comparison.tokens': 'Tokens', 'comparison.ttft': 'TTFT',
  'comparison.eval': 'Eval', 'comparison.trial': 'Trial', 'comparison.protocol': 'Protocol',
  'comparison.invalid': 'Invalid',
  'trajectory.empty': 'No canonical trajectory events',
  'table.combinationTitle': 'Benchmark combinations',
  'table.combinationHint': 'All tested combinations across iterations, ranked by complete equal-weight score',
  'table.taskTitle': 'Task comparison',
  'table.taskHint': 'Fix Harness or Model, then select trajectories from one task row',
  'table.rank': 'Rank', 'table.iterationDirection': 'Iteration / direction',
  'table.noDirection': 'No direction summary', 'table.coverage': 'Coverage',
  'table.operation': 'Action', 'table.bringToCompare': 'Use in comparison',
  'table.benchmark': 'Benchmark', 'table.harnessFilter': 'Harness', 'table.modelFilter': 'Model',
  'table.all': 'All', 'table.statusComplete': 'Complete', 'table.statusProvisional': 'Provisional',
  'table.statusUnresolved': 'Identity unresolved',
  'table.fixedDimension': 'Select multiple values in only one dimension; fix either Harness or Model.',
  'table.difference': 'Difference', 'table.selectedTrajectories': 'trajectories selected',
  'table.enterComparison': 'Open trajectory comparison', 'table.chooseAttempt': 'Choose attempt',
  'table.noMatchingCombinations': 'No matching experiment combinations',
  'table.selectionHelp': 'Select 2–4 trajectories from the same task row.',
  'table.candidate': 'Candidate',
  'table.noTaskData': 'No task data',
  'status.queued': 'Queued', 'status.preparing': 'Preparing', 'status.evaluating': 'Evaluating',
  'status.settled': 'Settled', 'status.running': 'Running', 'status.rerunning': 'Rerunning', 'status.awaitingReview': 'Awaiting review',
  'status.completed': 'Completed', 'status.succeeded': 'Succeeded', 'status.failed': 'Failed',
  'status.timedOut': 'Timed out', 'status.cancelled': 'Cancelled', 'status.corrupt': 'Corrupt',
  'status.pending': 'Pending', 'status.regressed': 'Regressed', 'status.invalid': 'Invalid',
  'status.improved': 'Improved', 'status.unchanged': 'Unchanged', 'status.valid': 'Valid',
  'status.missing': 'Missing',
}

/** Simplified Chinese refinement workbench dictionary. */
export const zh: Record<RefinementKey, string> = {
  'view.refinement': '优化',
  'empty.title': '暂无 Gear 实验',
  'empty.body': '配置的 Gear 状态目录中暂无已落盘实验。',
  loading: '加载中…', unknown: '未知',
  'overview.title': '迭代总览', 'evaluation.title': '迭代测评',
  'evaluation.failedEvidence': '失败评测',
  'comparison.title': '任务轨迹对比', back: '返回',
  status: '状态', objective: '目标', iterations: '迭代', open: '打开',
  strict: '严格对比', exploratory: '探索性对比', task: '任务',
  baseline: '基线', candidate: '候选', delta: '差值', state: '状态',
  compare: '对比轨迹', attempts: '次尝试', 'evidence.raw': '原始证据',
  'evidence.hide': '收起原始证据',
  'evidence.canonical': '规范化轨迹', unpaired: '未配对尝试',
  'evidence.next': '下一页原始轨迹', 'dimension.harness': 'Harness',
  'dimension.model': '模型', runs: '运行记录',
  'overview.kicker': '当前 Benchmark', 'overview.bestScore': '最高分',
  'overview.leadingCombination': '领先组合', 'overview.harnessVersion': '执行器版本',
  'overview.benchmarkVersion': 'Benchmark 版本', 'overview.openBreakdown': '查看实验明细',
  'overview.noScore': '等待有效评分', 'overview.history': '优化记录',
  'overview.updated': '更新于', 'overview.provisional': '临时结果',
  'portfolio.kicker': '多目标评测', 'portfolio.dashboard': 'Benchmark 组合看板',
  'portfolio.title': '多 Benchmark 优化', 'portfolio.benchmarks': 'Benchmark 数',
  'portfolio.guardrails': '回归红线通过', 'portfolio.guardrailHint': '单项回退上限',
  'portfolio.leadingDelta': '领先方案平均差值', 'portfolio.candidate': '候选方案',
  'portfolio.meanReward': '等权平均得分', 'portfolio.meanDelta': '平均差值',
  'portfolio.pareto': 'Pareto 前沿', 'portfolio.tradeoff': '质量 × 延迟',
  'portfolio.paretoTitle': '质量与延迟权衡', 'portfolio.latency': '平均延迟',
  'portfolio.paretoHint': '描边节点位于 Pareto 前沿',
  'portfolio.noData': '评测完成后将在这里显示 Benchmark 组合结果',
  'portfolio.selectedBenchmark': '当前 Benchmark',
  'breakdown.kicker': '实验明细', 'breakdown.experiments': '实验方向',
  'breakdown.tasks': '任务结果', 'breakdown.validRuns': '有效运行',
  'breakdown.taskCoverage': '任务覆盖', 'breakdown.score': '得分',
  'breakdown.noScore': '暂无有效得分', 'breakdown.noTasks': '评测完成后将在这里显示任务结果',
  'breakdown.iteration': '迭代', 'breakdown.all': '全部', 'breakdown.improved': '提升',
  'breakdown.regressed': '回退', 'breakdown.unchanged': '持平',
  'breakdown.best': '最佳',
  'comparison.chooseRuns': '选择轨迹', 'comparison.chooseHint': '选择同一任务下的 1–4 条运行轨迹',
  'comparison.reward': '得分', 'comparison.duration': '耗时', 'comparison.tools': '工具调用',
  'comparison.tokens': 'Token', 'comparison.ttft': '首 Token 延迟',
  'comparison.eval': '评测', 'comparison.trial': '试验', 'comparison.protocol': '协议',
  'comparison.invalid': '无效',
  'trajectory.empty': '没有可显示的规范化轨迹事件',
  'table.combinationTitle': 'Benchmark 组合表',
  'table.combinationHint': '跨迭代展示所有已评测组合，按完整结果的等权平均得分排序',
  'table.taskTitle': 'Task 对比表',
  'table.taskHint': '固定 Harness 或模型，在同一任务行选择要对比的轨迹',
  'table.rank': '排名', 'table.iterationDirection': '迭代 / 方向',
  'table.noDirection': '暂无方向摘要', 'table.coverage': '覆盖率',
  'table.operation': '操作', 'table.bringToCompare': '带入对比',
  'table.benchmark': 'Benchmark', 'table.harnessFilter': 'Harness', 'table.modelFilter': '模型',
  'table.all': '全部', 'table.statusComplete': '完整', 'table.statusProvisional': '暂定',
  'table.statusUnresolved': '身份未解析',
  'table.fixedDimension': '只能在一个维度中多选，请固定 Harness 或模型。',
  'table.difference': '差异', 'table.selectedTrajectories': '条轨迹已选择',
  'table.enterComparison': '进入轨迹对比', 'table.chooseAttempt': '选择尝试',
  'table.noMatchingCombinations': '没有匹配的实验组合',
  'table.selectionHelp': '请在同一个 Task 行选择 2–4 条轨迹。',
  'table.candidate': '候选',
  'table.noTaskData': '暂无 Task 数据',
  'status.queued': '排队中', 'status.preparing': '准备中', 'status.evaluating': '评测中',
  'status.settled': '已结算', 'status.running': '运行中', 'status.rerunning': '重跑中', 'status.awaitingReview': '等待审核',
  'status.completed': '已完成', 'status.succeeded': '成功', 'status.failed': '失败',
  'status.timedOut': '已超时', 'status.cancelled': '已取消', 'status.corrupt': '数据损坏',
  'status.pending': '等待中', 'status.regressed': '回退', 'status.invalid': '无效',
  'status.improved': '提升', 'status.unchanged': '持平', 'status.valid': '有效',
  'status.missing': '缺失',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Gear experiment workbench copy. */
    refinement: RefinementKey
  }
}
