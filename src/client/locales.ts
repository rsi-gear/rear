/** Refinement workbench copy keys. */
export type RefinementKey =
  | 'view.refinement' | 'empty.title' | 'empty.body' | 'loading' | 'unknown'
  | 'overview.title' | 'evaluation.title' | 'comparison.title' | 'back'
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
  | 'trajectory.session' | 'trajectory.events' | 'trajectory.timeMode'
  | 'trajectory.clock' | 'trajectory.relative' | 'trajectory.empty'
  | 'trajectory.assistant' | 'trajectory.toolCall' | 'trajectory.toolResult'
  | 'trajectory.lifecycle' | 'trajectory.event' | 'trajectory.turn'
  | 'trajectory.step' | 'trajectory.details'
  | 'trajectory.toolbar' | 'trajectory.timeline' | 'trajectory.durationHint'
  | 'trajectory.turnsHint' | 'trajectory.callsHint' | 'trajectory.search'
  | 'trajectory.searchPlaceholder' | 'trajectory.noMatches' | 'trajectory.closeDetails'
  | 'trajectory.toolbarDuration' | 'trajectory.toolbarTurns' | 'trajectory.toolbarCalls'
  | 'trajectory.input' | 'trajectory.model' | 'trajectory.tools' | 'trajectory.kindTool'
  | 'trajectory.seq' | 'breakdown.best'
  | 'status.queued' | 'status.preparing' | 'status.evaluating' | 'status.settled'
  | 'status.running' | 'status.awaitingReview' | 'status.completed' | 'status.succeeded'
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
  'comparison.title': 'Task trajectory comparison', back: 'Back',
  status: 'Status', objective: 'Objective', iterations: 'Iterations', open: 'Open',
  strict: 'Strict comparison', exploratory: 'Exploratory comparison', task: 'Task',
  baseline: 'Baseline', candidate: 'Candidate', delta: 'Delta', state: 'State',
  compare: 'Compare trajectories', attempts: 'attempts', 'evidence.raw': 'Raw trajectory',
  'evidence.hide': 'Hide raw trajectory',
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
  'trajectory.session': 'Persisted session', 'trajectory.events': 'events',
  'trajectory.timeMode': 'Timeline time mode', 'trajectory.clock': 'Clock',
  'trajectory.relative': 'Elapsed', 'trajectory.empty': 'No canonical trajectory events',
  'trajectory.assistant': 'Assistant', 'trajectory.toolCall': 'Tool call',
  'trajectory.toolResult': 'Tool result', 'trajectory.lifecycle': 'Lifecycle',
  'trajectory.event': 'Event', 'trajectory.turn': 'Turn', 'trajectory.step': 'Step',
  'trajectory.details': 'event JSON',
  'trajectory.toolbar': 'Trajectory toolbar', 'trajectory.timeline': 'Trajectory timeline',
  'trajectory.durationHint': 'Use actual duration', 'trajectory.turnsHint': 'Collapse turns',
  'trajectory.callsHint': 'Collapse calls', 'trajectory.search': 'Search trajectory',
  'trajectory.searchPlaceholder': 'Search', 'trajectory.noMatches': 'No matching trajectory records',
  'trajectory.closeDetails': 'Close details',
  'trajectory.toolbarDuration': 'Duration', 'trajectory.toolbarTurns': 'Turns',
  'trajectory.toolbarCalls': 'Calls', 'trajectory.input': 'Input', 'trajectory.model': 'Model',
  'trajectory.tools': 'Tools', 'trajectory.kindTool': 'Tool', 'trajectory.seq': 'seq',
  'status.queued': 'Queued', 'status.preparing': 'Preparing', 'status.evaluating': 'Evaluating',
  'status.settled': 'Settled', 'status.running': 'Running', 'status.awaitingReview': 'Awaiting review',
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
  'comparison.title': '任务轨迹对比', back: '返回',
  status: '状态', objective: '目标', iterations: '迭代', open: '打开',
  strict: '严格对比', exploratory: '探索性对比', task: '任务',
  baseline: '基线', candidate: '候选', delta: '差值', state: '状态',
  compare: '对比轨迹', attempts: '次尝试', 'evidence.raw': '原始轨迹',
  'evidence.hide': '收起原始轨迹',
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
  'trajectory.session': '持久化会话', 'trajectory.events': '个事件',
  'trajectory.timeMode': '时间轴显示方式', 'trajectory.clock': '时钟',
  'trajectory.relative': '相对时间', 'trajectory.empty': '没有可显示的规范化轨迹事件',
  'trajectory.assistant': '助手', 'trajectory.toolCall': '工具调用',
  'trajectory.toolResult': '工具结果', 'trajectory.lifecycle': '生命周期',
  'trajectory.event': '事件', 'trajectory.turn': '轮次', 'trajectory.step': '步骤',
  'trajectory.details': '事件 JSON',
  'trajectory.toolbar': '轨迹工具栏', 'trajectory.timeline': '轨迹时间线',
  'trajectory.durationHint': '使用实际耗时', 'trajectory.turnsHint': '折叠轮次',
  'trajectory.callsHint': '折叠调用', 'trajectory.search': '搜索轨迹',
  'trajectory.searchPlaceholder': '搜索', 'trajectory.noMatches': '没有匹配的轨迹记录',
  'trajectory.closeDetails': '关闭详情',
  'trajectory.toolbarDuration': '耗时', 'trajectory.toolbarTurns': '轮次',
  'trajectory.toolbarCalls': '调用', 'trajectory.input': '输入', 'trajectory.model': '模型',
  'trajectory.tools': '工具', 'trajectory.kindTool': '工具', 'trajectory.seq': '序号',
  'status.queued': '排队中', 'status.preparing': '准备中', 'status.evaluating': '评测中',
  'status.settled': '已结算', 'status.running': '运行中', 'status.awaitingReview': '等待审核',
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
