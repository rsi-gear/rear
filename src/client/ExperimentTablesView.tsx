import { runAggregationIdentity, uniqueTrialRuns } from '../run-scoring.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  HitchRunId,
  RefinementEvaluationView,
  RefinementRecordV1,
  RefinementRunView,
} from '../types.ts'
import {
  experimentCombinationTable,
  experimentTaskMatrix,
  modelIdentity,
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
  runs: 'rear-refinement-task-runs', empty: 'rear-refinement-empty',
  stickyAction: 'rear-refinement-compare-action', selectable: 'rear-refinement-selectable-score',
  attempts: 'rear-refinement-attempt-options', attempt: 'rear-refinement-attempt-option',
  headerFilter: 'rear-refinement-table-header-filter',
  copyInfo: 'rear-refinement-copy-info', copyPanel: 'rear-refinement-copy-panel',
  copyDialog: 'rear-refinement-copy-dialog',
  iterationChoice: 'rear-refinement-iteration-choice',
} as const

type T = (key: RefinementKey) => string
type CombinationSort = 'default' | 'iteration' | 'score' | 'coverage'

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

function ProcessScore({ value, count, total, t }: { readonly value: number | null | undefined; readonly count?: number | undefined; readonly total?: number | undefined; readonly t: T }) {
  return value === undefined || value === null ? null : <span className={css.runs}>{t('score.process')} {score(value)}
    {count !== undefined && total !== undefined && count < total && <> · {count}/{total} {t('task')}</>}
  </span>
}

function CombinationStatus({ row, t }: { readonly row: ExperimentCombinationRow; readonly t: T }) {
  const label = row.status === 'complete' ? t('table.statusComplete')
    : t('table.statusProvisional')
  const tone = row.status === 'complete' ? 'best' : undefined
  return <span className={css.pill} data-tone={tone}>{label}</span>
}

function SortButton({ active, children, onClick }: {
  readonly active: boolean
  readonly children: string
  readonly onClick: () => void
}) {
  return <button type="button" data-active={active} onClick={onClick}>{children}{active ? ' ↓' : ''}</button>
}

function copyText(value: string): void {
  void navigator.clipboard.writeText(value).catch(() => {})
}

interface CopyableItem {
  readonly label: string
  readonly value: string
}

function CopyableInfo({ summary, items, copyLabel, title, closeLabel }: {
  readonly summary: ReactNode
  readonly items: readonly CopyableItem[]
  readonly copyLabel: string
  readonly title: string
  readonly closeLabel: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const copyValue = items.map(item => `${item.label}: ${item.value}`).join('\n')
  return <>
    <button type="button" className={css.copyInfo} onClick={() => { dialog.current?.showModal() }}>{summary}</button>
    <dialog ref={dialog} className={css.copyDialog} onClick={event => {
      if (event.target === event.currentTarget) event.currentTarget.close()
    }}>
      <div>
        <header><strong>{title}</strong><button type="button" aria-label={closeLabel} onClick={() => { dialog.current?.close() }}>×</button></header>
        <div className={css.copyPanel}>
          {items.map(item => <div key={item.label}><span>{item.label}</span><code>{item.value}</code></div>)}
          <button type="button" onClick={() => { copyText(copyValue) }}>{copyLabel}</button>
        </div>
      </div>
    </dialog>
  </>
}

/** Two-table experiment detail: choose two scored iterations, then inspect task changes. */
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
  const [combinationHarnessKey, setCombinationHarnessKey] = useState<string | null>(null)
  const [combinationModelKey, setCombinationModelKey] = useState<string | null>(null)
  const [combinationSort, setCombinationSort] = useState<CombinationSort>('default')
  const [benchmarkSelection, setBenchmarkSelection] = useState<string | null>(null)
  const [comparisonSelection, setComparisonSelection] = useState<readonly string[]>([])
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [selectedRunIds, setSelectedRunIds] = useState<readonly HitchRunId[]>([])

  const activeBenchmarkKey = table.benchmarks.some(item => item.key === benchmarkSelection)
    ? benchmarkSelection
    : table.benchmarks[0]?.key ?? null
  const activeCombinationHarnessKey = table.harnesses.some(item => item.key === combinationHarnessKey)
    ? combinationHarnessKey : null
  const activeCombinationModelKey = table.models.some(item => item.key === combinationModelKey)
    ? combinationModelKey : null
  const validComparisonKeys = new Set(table.rows.map(row => row.key))
  const activeComparisonKeys = comparisonSelection.filter(key => validComparisonKeys.has(key))
  const matrix = useMemo(() => experimentTaskMatrix(
    table,
    evaluationHistory,
    activeBenchmarkKey,
    activeComparisonKeys,
  ), [table, evaluationHistory, activeBenchmarkKey, activeComparisonKeys.join('\u0000')])

  const visibleRows = useMemo(() => {
    const rows = table.rows.filter(row => (activeCombinationHarnessKey === null || row.harness.key === activeCombinationHarnessKey)
      && (activeCombinationModelKey === null || row.model.key === activeCombinationModelKey))
    if (combinationSort === 'default') return rows
    return [...rows].sort((left, right) => {
      if (combinationSort === 'iteration') return right.iterationOrdinal - left.iterationOrdinal
      if (combinationSort === 'score') return (right.meanScore ?? Number.NEGATIVE_INFINITY) - (left.meanScore ?? Number.NEGATIVE_INFINITY)
      const leftCoverage = left.coverageTotal === null ? 0 : left.coverageCompleted / Math.max(1, left.coverageTotal)
      const rightCoverage = right.coverageTotal === null ? 0 : right.coverageCompleted / Math.max(1, right.coverageTotal)
      return rightCoverage - leftCoverage
    })
  }, [table.rows, activeCombinationHarnessKey, activeCombinationModelKey, combinationSort])

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
  const selectedProtocols = new Set(selectedRuns.map(run => runAggregationIdentity(run)))
  const selectedHarnesses = new Set(selectedRuns.map(run => `${run.harness.id}\u0000${run.harness.revisionIdentity ?? ''}`))
  const selectedModels = new Set(selectedRuns.map(run => modelIdentity({
    provider: run.model.provider,
    modelId: run.model.effectiveId ?? run.model.requestedId,
  })))
  const canCompare = selectedRuns.length >= 1 && selectedRuns.length <= 4
    && selectedProtocols.size === 1
    && (selectedHarnesses.size === 1 || selectedModels.size === 1)

  useEffect(() => {
    setSelectedTaskKey(null)
    setSelectedRunIds([])
  }, [activeBenchmarkKey, activeComparisonKeys.join('\u0000')])

  useEffect(() => {
    setComparisonSelection([])
    setCombinationHarnessKey(null)
    setCombinationModelKey(null)
  }, [detail.id])

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

  const setComparisonIteration = (row: ExperimentCombinationRow, selected: boolean): void => {
    setComparisonSelection(current => {
      const valid = current.filter(key => validComparisonKeys.has(key))
      if (!selected) return valid.filter(key => key !== row.key)
      return valid.includes(row.key) ? valid : [...valid, row.key]
    })
    setSelectedTaskKey(null)
    setSelectedRunIds([])
  }

  return (
    <div className={css.root}>
      <section className={css.section}>
        <div className={css.sectionHeader}>
          <div><span className={css.kicker}>01 · Benchmark</span><h2>{t('table.combinationTitle')}</h2><span className={css.muted}>{t('table.combinationHint')}</span></div>
        </div>
        {visibleRows.length === 0 ? <div className={css.empty}>{t('table.noMatchingCombinations')}</div> : (
          <div className={css.tableWrap}>
            <table className={`${css.table} ${css.combinationTable}`}>
              <thead><tr>
                <th>{t('table.rank')}</th>
                <th><SortButton active={combinationSort === 'iteration'} onClick={() => { setCombinationSort('iteration') }}>{t('table.iterationDirection')}</SortButton></th>
                <th>{t('state')}</th>
                <th><label className={css.headerFilter}><span>Harness</span>
                  <select aria-label={t('table.harnessFilter')} value={activeCombinationHarnessKey ?? ''} onChange={event => { setCombinationHarnessKey(event.currentTarget.value || null) }}>
                    <option value="">{t('table.all')}</option>
                    {table.harnesses.map(item => <option value={item.key} key={item.key}>{item.id} · {short(item.revision, t('unknown'))}</option>)}
                  </select>
                </label></th>
                <th><label className={css.headerFilter}><span>{t('dimension.model')}</span>
                  <select aria-label={t('table.modelFilter')} value={activeCombinationModelKey ?? ''} onChange={event => { setCombinationModelKey(event.currentTarget.value || null) }}>
                    <option value="">{t('table.all')}</option>
                    {table.models.map(item => <option value={item.key} key={item.key}>{item.id}</option>)}
                  </select>
                </label></th>
                {table.benchmarks.map(benchmark => <th key={benchmark.key}>{benchmark.id}</th>)}
                <th><SortButton active={combinationSort === 'score'} onClick={() => { setCombinationSort('score') }}>{t('portfolio.meanReward')}</SortButton></th>
                <th><SortButton active={combinationSort === 'coverage'} onClick={() => { setCombinationSort('coverage') }}>{t('table.coverage')}</SortButton></th>
              </tr></thead>
              <tbody>{visibleRows.map((row, index) => {
                const evaluationIds = [...new Set(row.cells.flatMap(cell => cell.score?.evaluationIds ?? []))]
                const evalValue = evaluationIds.length === 0 ? t('unknown') : evaluationIds.join('\n')
                return <tr key={row.key}>
                  <td><strong>{index + 1}</strong>{row.key === table.leadingRow?.key && <span className={css.pill} data-tone="best">{t('breakdown.best')}</span>}</td>
                  <td className={css.identity}>
                    <div className={css.iterationChoice}>
                      <input
                        type="checkbox"
                        aria-label={`${t('table.selectIteration')} ${String(row.iterationOrdinal).padStart(2, '0')}`}
                        checked={activeComparisonKeys.includes(row.key)}
                        onChange={event => { setComparisonIteration(row, event.currentTarget.checked) }}
                      />
                      <CopyableInfo copyLabel={t('table.copy')} title={t('table.fullInfo')} closeLabel={t('table.close')} summary={<>
                        <strong>{t('breakdown.iteration')} {String(row.iterationOrdinal).padStart(2, '0')}</strong>
                        <span>{row.directionSummary ?? t('table.noDirection')}</span>
                        <small>Eval ID · {short(evaluationIds[0], t('unknown'))}</small>
                      </>} items={[
                        { label: t('breakdown.iteration'), value: String(row.iterationOrdinal).padStart(2, '0') },
                        { label: t('table.iterationDirection'), value: row.directionSummary ?? t('table.noDirection') },
                        { label: t('table.candidate'), value: row.candidateLabel },
                        { label: 'Eval ID', value: evalValue },
                      ]} />
                    </div>
                  </td>
                  <td><CombinationStatus row={row} t={t} /></td>
                  <td className={css.identity}><CopyableInfo copyLabel={t('table.copy')} title={t('table.fullInfo')} closeLabel={t('table.close')} summary={<>
                    <strong>{row.harness.id}</strong><span>{short(row.harness.revision, t('unknown'))}</span>
                  </>} items={[
                    { label: 'Harness', value: row.harness.id },
                    { label: t('overview.harnessVersion'), value: row.harness.revision ?? t('unknown') },
                  ]} /></td>
                  <td className={css.identity}><strong>{row.model.id}</strong><span>{row.model.provider ?? t('unknown')}</span></td>
                  {row.cells.map(cell => <td className={css.score} key={cell.benchmark.key} title={cell.failure ?? undefined} data-status={cell.failure !== null ? 'failed' : cell.score === null ? 'missing' : cell.delta !== null && cell.delta < 0 ? 'regressed' : undefined}>
                    <strong>{score(cell.score?.mean)}</strong><span className={css.runs}>{cell.failure ?? (cell.score === null ? '—' : `${cell.score.taskCount}/${display(cell.score.plannedTaskCount, '?')}`)}</span>
                    <ProcessScore value={cell.score?.processMean} count={cell.score?.processTaskCount} total={cell.score?.taskCount} t={t} />
                  </td>)}
                  <td className={css.score}><strong>{score(row.meanScore)}</strong><span className={css.runs}>{row.validRuns} {t('runs')}</span></td>
                  <td>{row.coverageCompleted}/{display(row.coverageTotal, '?')}</td>
                </tr>
              })}</tbody>
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
                  {table.benchmarks.map(item => <option value={item.key} key={item.key}>{item.id}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        {activeComparisonKeys.length === 0 ? <div className={css.empty}>{t('table.chooseIterations')}</div>
          : matrix.columns.length === 0 ? <div className={css.empty}>{t('table.noMatchingCombinations')}</div>
            : (
              <div className={css.tableWrap}>
                <table className={`${css.table} ${css.taskTable}`}>
                  <thead><tr><th>{t('task')}</th>{matrix.columns.map(column => (
                    <th key={column.key}>{t('breakdown.iteration')} {String(column.iterationOrdinal).padStart(2, '0')}</th>
                  ))}</tr></thead>
                  <tbody>{matrix.rows.map(row => (
                    <tr key={row.taskKey}>
                      <td className={css.identity}><strong>{row.taskId}</strong></td>
                      {row.cells.map(cell => {
                        const selectable = cell.selectableRunIds
                        if (selectable.length === 0) return <td className={css.score} key={cell.columnKey}><strong>{score(cell.mean)}</strong><ProcessScore value={cell.processMean} t={t} /><span className={css.runs}>{uniqueTrialRuns(cell.runs).length} {t('attempts')}</span></td>
                        if (selectable.length === 1) {
                          const runId = selectable[0] as HitchRunId
                          const selected = selectedRunIds.includes(runId)
                          return <td className={css.score} key={cell.columnKey}>
                            <button type="button" className={css.selectable} aria-pressed={selected} data-selected={selected} onClick={() => { toggleRun(row.taskKey, runId) }}>
                              <strong>{score(cell.mean)}</strong><ProcessScore value={cell.processMean} t={t} /><span>{uniqueTrialRuns(cell.runs).length} {t('attempts')} · ↗</span>
                            </button>
                          </td>
                        }
                        return <td className={css.score} key={cell.columnKey}>
                          <details className={css.attempts}><summary><strong>{score(cell.mean)}</strong><ProcessScore value={cell.processMean} t={t} /><span>{uniqueTrialRuns(cell.runs).length} {t('attempts')}</span></summary>
                            <div>{selectable.map(runId => {
                              const run = runById.get(runId)
                              const selected = selectedRunIds.includes(runId)
                              return <label className={css.attempt} data-selected={selected} key={runId}>
                                <input type="checkbox" checked={selected} onChange={() => { toggleRun(row.taskKey, runId) }} />
                                #{run?.attempt ?? '?'} {run?.phase && `${t('trajectory.phase')} ${run.phase.index}/${run.phase.count}`} · {run?.observation.state === 'valid' ? score(run.observation.reward) : t('unknown')}
                              </label>
                            })}</div>
                          </details>
                        </td>
                      })}
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
