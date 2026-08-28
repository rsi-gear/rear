import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type {
  HitchRunId,
  RefinementEvaluationView,
  RefinementRecordV1,
  RefinementRunView,
} from '../types.ts'
import { aggregationProtocolIdentity } from './benchmark-dashboard.ts'
import {
  comparableTaskSelection,
  experimentCombinationTable,
  experimentTaskMatrix,
  type ExperimentCombinationRow,
} from './experiment-tables.ts'
import type { RefinementKey } from './locales.ts'

const css = {
  root: 'rear-refinement-detail-tables', section: 'rear-refinement-section',
  sectionHeader: 'rear-refinement-section-header', kicker: 'rear-refinement-kicker',
  muted: 'rear-refinement-muted', controls: 'rear-refinement-table-controls',
  control: 'rear-refinement-table-control', tableWrap: 'rear-refinement-table-wrap',
  table: 'rear-refinement-table', combinationTable: 'rear-refinement-combination-table',
  taskTable: 'rear-refinement-task-table', identity: 'rear-refinement-task-identity',
  pill: 'rear-refinement-pill', row: 'rear-refinement-row', score: 'rear-refinement-task-score',
  delta: 'rear-refinement-task-delta', runs: 'rear-refinement-task-runs',
  action: 'rear-refinement-task-action', empty: 'rear-refinement-empty',
  stickyAction: 'rear-refinement-compare-action', selectable: 'rear-refinement-selectable-score',
  attempts: 'rear-refinement-attempt-options', attempt: 'rear-refinement-attempt-option',
} as const

type T = (key: RefinementKey) => string
type CombinationSort = 'default' | 'iteration' | 'score' | 'delta' | 'coverage'

function display(value: string | number | null | undefined, fallback: string): string {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function short(value: string | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback
  return value.length > 18 ? `${value.slice(0, 14)}…` : value
}

function score(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(3)
}

function delta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}`
}

function multipleValues(event: ChangeEvent<HTMLSelectElement>): string[] {
  return [...event.currentTarget.selectedOptions].map(option => option.value)
}

function CombinationStatus({ row, t }: { readonly row: ExperimentCombinationRow; readonly t: T }) {
  const label = row.status === 'complete' ? t('table.statusComplete')
    : row.status === 'provisional' ? t('table.statusProvisional')
      : row.status === 'unresolved' ? t('table.statusUnresolved') : t('status.failed')
  const tone = row.status === 'complete' ? 'best' : row.status === 'failed' || row.status === 'unresolved' ? 'warning' : undefined
  return <span className={css.pill} data-tone={tone}>{label}</span>
}

function SortButton({ active, children, onClick }: {
  readonly active: boolean
  readonly children: string
  readonly onClick: () => void
}) {
  return <button type="button" data-active={active} onClick={onClick}>{children}{active ? ' ↓' : ''}</button>
}

/** Two-table experiment detail selected entirely by Benchmark, Harness, and Model. */
export function ExperimentTablesView({
  detail,
  evaluationHistory,
  onSelectRuns,
  t,
}: {
  readonly detail: RefinementRecordV1
  readonly evaluationHistory: Readonly<Record<string, RefinementEvaluationView>>
  readonly onSelectRuns: (runIds: readonly HitchRunId[]) => Promise<void>
  readonly t: T
}) {
  const table = useMemo(() => experimentCombinationTable(
    detail.iterations,
    detail.candidates,
    detail.baselineCandidateId,
    evaluationHistory,
  ), [detail, evaluationHistory])
  const [combinationHarnessKeys, setCombinationHarnessKeys] = useState<readonly string[]>([])
  const [combinationModelKeys, setCombinationModelKeys] = useState<readonly string[]>([])
  const [combinationSort, setCombinationSort] = useState<CombinationSort>('default')
  const [benchmarkSelection, setBenchmarkSelection] = useState<string | null>(null)
  const [harnessSelection, setHarnessSelection] = useState<readonly string[]>([])
  const [modelSelection, setModelSelection] = useState<readonly string[]>([])
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [selectedRunIds, setSelectedRunIds] = useState<readonly HitchRunId[]>([])

  const defaultRow = table.leadingRow ?? table.rows[0] ?? null
  const activeBenchmarkKey = table.benchmarks.some(item => item.key === benchmarkSelection)
    ? benchmarkSelection
    : table.benchmarks[0]?.key ?? null
  const defaultTaskSelection = comparableTaskSelection(table, defaultRow, activeBenchmarkKey)
  const validHarnessKeys = new Set(table.harnesses.map(item => item.key))
  const validModelKeys = new Set(table.models.map(item => item.key))
  const selectedHarnessKeys = harnessSelection.filter(key => validHarnessKeys.has(key))
  const selectedModelKeys = modelSelection.filter(key => validModelKeys.has(key))
  const activeHarnessKeys = selectedHarnessKeys.length > 0 ? selectedHarnessKeys
    : defaultTaskSelection.harnessKeys
  const activeModelKeys = selectedModelKeys.length > 0 ? selectedModelKeys
    : defaultTaskSelection.modelKeys
  const matrix = useMemo(() => experimentTaskMatrix(
    table,
    evaluationHistory,
    activeBenchmarkKey,
    activeHarnessKeys,
    activeModelKeys,
  ), [table, evaluationHistory, activeBenchmarkKey, activeHarnessKeys.join('\u0000'), activeModelKeys.join('\u0000')])

  const visibleRows = useMemo(() => {
    const harnesses = new Set(combinationHarnessKeys)
    const models = new Set(combinationModelKeys)
    const rows = table.rows.filter(row => (harnesses.size === 0 || harnesses.has(row.harness.key))
      && (models.size === 0 || models.has(row.model.key)))
    if (combinationSort === 'default') return rows
    return [...rows].sort((left, right) => {
      if (combinationSort === 'iteration') return right.iterationOrdinal - left.iterationOrdinal
      if (combinationSort === 'score') return (right.meanScore ?? Number.NEGATIVE_INFINITY) - (left.meanScore ?? Number.NEGATIVE_INFINITY)
      if (combinationSort === 'delta') return (right.meanDelta ?? Number.NEGATIVE_INFINITY) - (left.meanDelta ?? Number.NEGATIVE_INFINITY)
      const leftCoverage = left.coverageTotal === null ? 0 : left.coverageCompleted / Math.max(1, left.coverageTotal)
      const rightCoverage = right.coverageTotal === null ? 0 : right.coverageCompleted / Math.max(1, right.coverageTotal)
      return rightCoverage - leftCoverage
    })
  }, [table.rows, combinationHarnessKeys, combinationModelKeys, combinationSort])

  const allRuns = useMemo(() => {
    const runs = Object.values(evaluationHistory).flatMap(evaluation => evaluation.evaluations)
      .flatMap(evaluation => evaluation.runs)
    return [...new Map(runs.map(run => [run.id, run])).values()]
  }, [evaluationHistory])
  const runById = useMemo(() => new Map(allRuns.map(run => [run.id, run])), [allRuns])
  const selectedRuns = selectedRunIds.flatMap(id => {
    const run = runById.get(id)
    return run === undefined ? [] : [run]
  })
  const selectedProtocols = new Set(selectedRuns.map(run => aggregationProtocolIdentity(run.protocolIdentity)))
  const selectedHarnesses = new Set(selectedRuns.map(run => `${run.harness.id}\u0000${run.harness.revisionIdentity ?? ''}`))
  const selectedModels = new Set(selectedRuns.map(run => `${run.model.provider ?? ''}\u0000${run.model.effectiveId ?? run.model.requestedId}`))
  const canCompare = selectedRuns.length >= 2 && selectedRuns.length <= 4
    && selectedProtocols.size === 1
    && (selectedHarnesses.size === 1 || selectedModels.size === 1)

  useEffect(() => {
    setSelectedTaskKey(null)
    setSelectedRunIds([])
  }, [activeBenchmarkKey, activeHarnessKeys.join('\u0000'), activeModelKeys.join('\u0000')])

  const toggleRun = (taskKey: string, runId: HitchRunId): void => {
    if (selectedTaskKey !== taskKey) {
      setSelectedTaskKey(taskKey)
      setSelectedRunIds([runId])
      return
    }
    if (selectedRunIds.includes(runId)) {
      setSelectedRunIds(selectedRunIds.filter(id => id !== runId))
      return
    }
    if (selectedRunIds.length < 4) setSelectedRunIds([...selectedRunIds, runId])
  }

  const bringToComparison = (row: ExperimentCombinationRow): void => {
    const firstBenchmark = row.cells.find(cell => cell.score !== null)?.benchmark.key ?? activeBenchmarkKey
    const selection = comparableTaskSelection(table, row, firstBenchmark)
    setBenchmarkSelection(selection.benchmarkKey)
    setHarnessSelection(selection.harnessKeys)
    setModelSelection(selection.modelKeys)
    setSelectedTaskKey(null)
    setSelectedRunIds([])
    queueMicrotask(() => { document.getElementById('rear-task-comparison-table')?.scrollIntoView({ behavior: 'smooth' }) })
  }

  return (
    <div className={css.root}>
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div><span className={css.kicker}>01 · Benchmark</span><h2>{t('table.combinationTitle')}</h2><span className={css.muted}>{t('table.combinationHint')}</span></div>
          <div className={css.controls}>
            {table.harnesses.length > 1 && (
              <label className={css.control}>{t('table.harnessFilter')}
                <select multiple value={combinationHarnessKeys as string[]} onChange={event => { setCombinationHarnessKeys(multipleValues(event)) }}>
                  {table.harnesses.map(item => <option value={item.key} key={item.key}>{item.id} · {short(item.revision, t('unknown'))}</option>)}
                </select>
                <small>{combinationHarnessKeys.length === 0 ? t('table.all') : String(combinationHarnessKeys.length)}</small>
              </label>
            )}
            {table.models.length > 1 && (
              <label className={css.control}>{t('table.modelFilter')}
                <select multiple value={combinationModelKeys as string[]} onChange={event => { setCombinationModelKeys(multipleValues(event)) }}>
                  {table.models.map(item => <option value={item.key} key={item.key}>{item.provider ?? t('unknown')} · {item.id}</option>)}
                </select>
                <small>{combinationModelKeys.length === 0 ? t('table.all') : String(combinationModelKeys.length)}</small>
              </label>
            )}
          </div>
        </div>
        {visibleRows.length === 0 ? <div className={css.empty}>{t('table.noMatchingCombinations')}</div> : (
          <div className={css.tableWrap}>
            <table className={`${css.table} ${css.combinationTable}`}>
              <thead><tr>
                <th>{t('table.rank')}</th>
                <th><SortButton active={combinationSort === 'iteration'} onClick={() => { setCombinationSort('iteration') }}>{t('table.iterationDirection')}</SortButton></th>
                <th>{t('state')}</th><th>Harness</th><th>{t('dimension.model')}</th>
                {table.benchmarks.map(benchmark => <th key={benchmark.key}>{benchmark.id}<span>{benchmark.revision}</span></th>)}
                <th><SortButton active={combinationSort === 'score'} onClick={() => { setCombinationSort('score') }}>{t('portfolio.meanReward')}</SortButton></th>
                <th><SortButton active={combinationSort === 'coverage'} onClick={() => { setCombinationSort('coverage') }}>{t('table.coverage')}</SortButton></th>
                <th><SortButton active={combinationSort === 'delta'} onClick={() => { setCombinationSort('delta') }}>{t('portfolio.meanDelta')}</SortButton></th>
                <th>{t('table.operation')}</th>
              </tr></thead>
              <tbody>{visibleRows.map((row, index) => (
                <tr key={row.key} data-status={row.status} data-best={row.key === table.leadingRow?.key}>
                  <td><strong>{index + 1}</strong>{row.key === table.leadingRow?.key && <span className={css.pill} data-tone="best">{t('breakdown.best')}</span>}</td>
                  <td className={css.identity}>
                    <strong>{t('breakdown.iteration')} {String(row.iterationOrdinal).padStart(2, '0')}</strong>
                    <span>{row.directionSummary ?? t('table.noDirection')}</span>
                    <small>{row.candidateLabel}</small>
                  </td>
                  <td><CombinationStatus row={row} t={t} /></td>
                  <td className={css.identity}><strong>{row.harness.id}</strong><span title={row.harness.revision ?? undefined}>{short(row.harness.revision, t('unknown'))}</span></td>
                  <td className={css.identity}><strong>{row.model.id}</strong><span>{row.model.provider ?? t('unknown')}</span></td>
                  {row.cells.map(cell => <td className={css.score} key={cell.benchmark.key} title={cell.failure ?? undefined} data-status={cell.failure !== null ? 'failed' : cell.score === null ? 'missing' : cell.delta !== null && cell.delta < 0 ? 'regressed' : undefined}>
                    <strong>{score(cell.score?.mean)}</strong><span className={css.runs}>{cell.failure ?? (cell.score === null ? '—' : `${cell.score.taskCount}/${display(cell.score.plannedTaskCount, '?')}`)}</span>
                  </td>)}
                  <td className={css.score}><strong>{score(row.meanScore)}</strong><span className={css.runs}>{row.validRuns} {t('runs')}</span></td>
                  <td>{row.coverageCompleted}/{display(row.coverageTotal, '?')}</td>
                  <td className={css.delta} data-sign={row.meanDelta === null ? 'none' : row.meanDelta < 0 ? 'negative' : row.meanDelta > 0 ? 'positive' : 'neutral'}>{delta(row.meanDelta)}</td>
                  <td><button
                    type="button"
                    className={css.action}
                    disabled={!row.cells.some(cell => cell.score !== null)}
                    onClick={() => { bringToComparison(row) }}
                  >{row.cells.some(cell => cell.score !== null) ? `${t('table.bringToCompare')} ↓` : t('table.noTaskData')}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={css.section} id="rear-task-comparison-table">
        <div className={css.sectionHeader}>
          <div><span className={css.kicker}>02 · Task</span><h2>{t('table.taskTitle')}</h2><span className={css.muted}>{t('table.taskHint')}</span></div>
          <div className={css.controls}>
            {table.benchmarks.length > 1 && (
              <label className={css.control}>{t('table.benchmark')}
                <select value={activeBenchmarkKey ?? ''} onChange={event => { setBenchmarkSelection(event.currentTarget.value) }}>
                  {table.benchmarks.map(item => <option value={item.key} key={item.key}>{item.id} · {item.revision}</option>)}
                </select>
              </label>
            )}
            {table.harnesses.length > 1 && (
              <label className={css.control}>{t('table.harnessFilter')}
                <select multiple value={activeHarnessKeys as string[]} onChange={event => { setHarnessSelection(multipleValues(event)) }}>
                  {table.harnesses.map(item => <option value={item.key} key={item.key}>{item.id} · {short(item.revision, t('unknown'))}</option>)}
                </select>
              </label>
            )}
            {table.models.length > 1 && (
              <label className={css.control}>{t('table.modelFilter')}
                <select multiple value={activeModelKeys as string[]} onChange={event => { setModelSelection(multipleValues(event)) }}>
                  {table.models.map(item => <option value={item.key} key={item.key}>{item.provider ?? t('unknown')} · {item.id}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        {matrix.invalidSelection ? <p className="rear-refinement-error">{t('table.fixedDimension')}</p>
          : matrix.columns.length === 0 ? <div className={css.empty}>{t('table.noMatchingCombinations')}</div>
            : (
              <div className={css.tableWrap}>
                <table className={`${css.table} ${css.taskTable}`}>
                  <thead><tr><th>{t('task')}</th>{matrix.columns.map(column => (
                    <th key={column.key}>
                      {t('breakdown.iteration')} {String(column.iterationOrdinal).padStart(2, '0')} · {column.harness.id} × {column.model.id}
                      <span>{column.directionSummary ?? t('table.noDirection')}</span>
                    </th>
                  ))}<th>{t('table.difference')}</th></tr></thead>
                  <tbody>{matrix.rows.map(row => (
                    <tr key={row.taskKey} data-selected={row.taskKey === selectedTaskKey}>
                      <td className={css.identity}><strong>{row.taskId}</strong></td>
                      {row.cells.map(cell => {
                        const selectable = cell.selectableRunIds
                        if (selectable.length === 0) return <td className={css.score} key={cell.columnKey}><strong>{score(cell.mean)}</strong><span className={css.runs}>{cell.runs.length} {t('attempts')}</span></td>
                        if (selectable.length === 1) {
                          const runId = selectable[0] as HitchRunId
                          const selected = selectedRunIds.includes(runId)
                          return <td className={css.score} key={cell.columnKey}>
                            <button type="button" className={css.selectable} aria-pressed={selected} data-selected={selected} onClick={() => { toggleRun(row.taskKey, runId) }}>
                              <strong>{score(cell.mean)}</strong><span>{cell.runs.length} {t('attempts')} · ↗</span>
                            </button>
                          </td>
                        }
                        return <td className={css.score} key={cell.columnKey}>
                          <details className={css.attempts}><summary><strong>{score(cell.mean)}</strong><span>{selectable.length} {t('attempts')}</span></summary>
                            <div>{selectable.map(runId => {
                              const run = runById.get(runId)
                              const selected = selectedRunIds.includes(runId)
                              return <label className={css.attempt} data-selected={selected} key={runId}>
                                <input type="checkbox" checked={selected} onChange={() => { toggleRun(row.taskKey, runId) }} />
                                #{run?.attempt ?? '?'} · {run?.observation.state === 'valid' ? score(run.observation.reward) : t('unknown')}
                              </label>
                            })}</div>
                          </details>
                        </td>
                      })}
                      <td className={css.delta} data-sign={row.difference === null ? 'none' : row.difference < 0 ? 'negative' : row.difference > 0 ? 'positive' : 'neutral'}>{delta(row.difference)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
        <div className={css.stickyAction}>
          <span><strong>{selectedRunIds.length}</strong> {t('table.selectedTrajectories')}<small>{canCompare ? '' : t('table.selectionHelp')}</small></span>
          <button type="button" className="rear-refinement-action" disabled={!canCompare} onClick={() => { void onSelectRuns(selectedRunIds) }}>{t('table.enterComparison')} →</button>
        </div>
      </section>
    </div>
  )
}

/** Return all unique runs retained by the cross-iteration table state. */
export function experimentHistoryRuns(
  evaluationHistory: Readonly<Record<string, RefinementEvaluationView>>,
): readonly RefinementRunView[] {
  const runs = Object.values(evaluationHistory).flatMap(evaluation => evaluation.evaluations).flatMap(item => item.runs)
  return [...new Map(runs.map(run => [run.id, run])).values()]
}
