/** Refinement workbench copy keys. */
export type RefinementKey =
  | 'view.refinement' | 'empty.title' | 'empty.body' | 'loading' | 'unknown'
  | 'overview.title' | 'evaluation.title' | 'comparison.title' | 'back' | 'cancel'
  | 'status' | 'objective' | 'iterations' | 'open' | 'strict' | 'exploratory'
  | 'task' | 'baseline' | 'candidate' | 'delta' | 'state' | 'compare'
  | 'attempts' | 'evidence.raw' | 'evidence.canonical' | 'unpaired'
  | 'evidence.next' | 'dimension.harness' | 'dimension.model' | 'runs'
  | 'command.open' | 'command.running' | 'command.failed'

/** English refinement workbench dictionary. */
export const en: Record<RefinementKey, string> = {
  'view.refinement': 'Refine',
  'empty.title': 'No refinements yet',
  'empty.body': 'Run /refine [objective] in Chat to iterate and evaluate a harness.',
  loading: 'Loading…', unknown: 'Unknown',
  'overview.title': 'Refinement overview', 'evaluation.title': 'Iteration evaluation',
  'comparison.title': 'Task trajectory comparison', back: 'Back', cancel: 'Cancel',
  status: 'Status', objective: 'Objective', iterations: 'Iterations', open: 'Open',
  strict: 'Strict comparison', exploratory: 'Exploratory comparison', task: 'Task',
  baseline: 'Baseline', candidate: 'Candidate', delta: 'Delta', state: 'State',
  compare: 'Compare trajectories', attempts: 'attempts', 'evidence.raw': 'Provider evidence',
  'evidence.canonical': 'Canonical trajectory', unpaired: 'Unpaired attempts',
  'evidence.next': 'Next evidence page', 'dimension.harness': 'Harness',
  'dimension.model': 'Model', runs: 'Runs',
  'command.open': 'Open Refine', 'command.running': 'Starting refinement…',
  'command.failed': 'Refinement was not admitted',
}

/** Simplified Chinese refinement workbench dictionary. */
export const zh: Record<RefinementKey, string> = {
  'view.refinement': 'Refine',
  'empty.title': '暂无迭代',
  'empty.body': '在 Chat 中运行 /refine [目标]，开始迭代并测评 harness。',
  loading: '加载中…', unknown: '未知',
  'overview.title': '迭代总览', 'evaluation.title': '迭代测评',
  'comparison.title': '任务轨迹对比', back: '返回', cancel: '取消',
  status: '状态', objective: '目标', iterations: '迭代', open: '打开',
  strict: '严格对比', exploratory: '探索性对比', task: '任务',
  baseline: '基线', candidate: '候选', delta: '差值', state: '状态',
  compare: '对比轨迹', attempts: '次尝试', 'evidence.raw': 'Provider 原始证据',
  'evidence.canonical': '规范化轨迹', unpaired: '未配对尝试',
  'evidence.next': '下一页证据', 'dimension.harness': 'Harness',
  'dimension.model': '模型', runs: '运行记录',
  'command.open': '打开 Refine', 'command.running': '正在创建迭代…',
  'command.failed': '迭代未准入',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Refinement workbench and rich command-card copy. */
    refinement: RefinementKey
  }
}
