import { runAggregationIdentity } from '../run-scoring.ts'
import { VerifierEvidenceView } from './VerifierEvidenceView.tsx'
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RefinementId,
  RefinementInteractionEvidencePage,
  RefinementProviderEvidencePage,
  RefinementRunView,
} from '../types.ts'
import type { RefinementController } from './controller.ts'
import type { RefinementKey } from './locales.ts'
import {
  DshOfflineTrajectorySurface,
  type DshTrajectoryBridge,
} from './DshOfflineTrajectorySurface.tsx'
import { ExperimentTablesView, experimentHistoryRuns } from './ExperimentTablesView.tsx'
import { activeExperimentEvaluations, experimentCombinationTable } from './experiment-tables.ts'
import { TraceAnalysisPanel } from './TraceAnalysisPanel.tsx'
import { BlockComparison } from './BlockComparison.tsx'
import { analysisScopeKey, type TraceAnalysisController } from './analysis-controller.ts'
import type { NativeChatBridge } from './DshNativeChatSurface.tsx'
import { TraceWorkbench } from './TraceWorkbench.tsx'

const css = {
  root: 'rear-refinement-root', header: 'rear-refinement-header', list: 'rear-refinement-list',
  card: 'rear-refinement-card', row: 'rear-refinement-row', muted: 'rear-refinement-muted',
  error: 'rear-refinement-error', meta: 'rear-refinement-meta', table: 'rear-refinement-table',
  attempt: 'rear-refinement-attempt', lanes: 'rear-refinement-lanes', lane: 'rear-refinement-lane',
  laneHeader: 'rear-refinement-lane-header', laneBody: 'rear-refinement-lane-body',
  raw: 'rear-refinement-raw',
  topbar: 'rear-refinement-topbar', brand: 'rear-refinement-brand', brandMark: 'rear-refinement-brand-mark',
  status: 'rear-refinement-status', hero: 'rear-refinement-hero', heroCopy: 'rear-refinement-hero-copy',
  kicker: 'rear-refinement-kicker', heroTitle: 'rear-refinement-hero-title', heroScore: 'rear-refinement-hero-score',
  scoreLabel: 'rear-refinement-score-label', scoreValue: 'rear-refinement-score-value',
  heroCombo: 'rear-refinement-hero-combo', comboPrimary: 'rear-refinement-combo-primary',
  comboJoin: 'rear-refinement-combo-join', pill: 'rear-refinement-pill', facts: 'rear-refinement-facts',
  fact: 'rear-refinement-fact', factLabel: 'rear-refinement-fact-label', action: 'rear-refinement-action',
  secondary: 'rear-refinement-secondary', section: 'rear-refinement-section', sectionHeader: 'rear-refinement-section-header',
  history: 'rear-refinement-history', historyItem: 'rear-refinement-history-item',
  historyMain: 'rear-refinement-history-main', historyMeta: 'rear-refinement-history-meta',
  breadcrumb: 'rear-refinement-breadcrumb', iterationNav: 'rear-refinement-iteration-nav',
  segment: 'rear-refinement-segment', directions: 'rear-refinement-directions',
  direction: 'rear-refinement-direction', directionTop: 'rear-refinement-direction-top',
  directionScore: 'rear-refinement-direction-score', directionMeta: 'rear-refinement-direction-meta',
  summaryStrip: 'rear-refinement-summary-strip', summaryItem: 'rear-refinement-summary-item',
  tableWrap: 'rear-refinement-table-wrap', taskIdentity: 'rear-refinement-task-identity',
  taskScore: 'rear-refinement-task-score', taskDelta: 'rear-refinement-task-delta', taskRuns: 'rear-refinement-task-runs',
  taskAction: 'rear-refinement-task-action', empty: 'rear-refinement-empty', exclusions: 'rear-refinement-exclusions',
  runPicker: 'rear-refinement-run-picker', runGrid: 'rear-refinement-run-grid',
  runOption: 'rear-refinement-run-option', runOptionTop: 'rear-refinement-run-option-top',
  backButton: 'rear-refinement-back', comparisonHead: 'rear-refinement-comparison-head',
  filters: 'rear-refinement-filters', filter: 'rear-refinement-filter',
  portfolio: 'rear-refinement-portfolio', portfolioStats: 'rear-refinement-portfolio-stats',
  portfolioStat: 'rear-refinement-portfolio-stat', portfolioLayout: 'rear-refinement-portfolio-layout',
  matrix: 'rear-refinement-matrix', matrixCell: 'rear-refinement-matrix-cell',
  matrixValue: 'rear-refinement-matrix-value', matrixDelta: 'rear-refinement-matrix-delta',
  tradeoff: 'rear-refinement-tradeoff', tradeoffPlot: 'rear-refinement-tradeoff-plot',
  tradeoffLegend: 'rear-refinement-tradeoff-legend', benchmarkTabs: 'rear-refinement-benchmark-tabs',
} as const

/** Controller and layout actions used by the read-only Gear experiment view. */
export interface RefinementInjected {
  hooks: { refinement: RefinementController }
  ensure: () => Promise<void>
  selectRefinement: (refinementId: RefinementId) => Promise<void>
  selectIteration: RefinementController['selectIteration']
  setComparisonDimension: RefinementController['setComparisonDimension']
  openTask: RefinementController['openTask']
  selectRuns: RefinementController['selectRuns']
  back: RefinementController['back']
  loadProviderEvidence: RefinementController['loadProviderEvidence']
  closeProviderEvidence: RefinementController['closeProviderEvidence']
  loadInteractionEvidence: RefinementController['loadInteractionEvidence']
  closeInteractionEvidence: RefinementController['closeInteractionEvidence']
  closeDetails: () => void
  dshTrajectory: DshTrajectoryBridge
  analysis: TraceAnalysisController
  nativeChat: NativeChatBridge
}

type ViewProps = ConvViewProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'>

const STATUS_KEYS = {
  queued: 'status.queued', preparing: 'status.preparing', evaluating: 'status.evaluating', settled: 'status.settled',
  running: 'status.running', rerunning: 'status.rerunning', 'awaiting-review': 'status.awaitingReview', completed: 'status.completed',
  succeeded: 'status.succeeded', failed: 'status.failed', 'timed-out': 'status.timedOut', cancelled: 'status.cancelled',
  corrupt: 'status.corrupt', pending: 'status.pending', regressed: 'status.regressed', invalid: 'status.invalid',
  improved: 'status.improved', unchanged: 'status.unchanged', valid: 'status.valid', missing: 'status.missing',
} as const

function statusLabel(status: string, t: (key: RefinementKey) => string): string {
  const key = STATUS_KEYS[status as keyof typeof STATUS_KEYS]
  return key === undefined ? status : t(key)
}

function display(value: string | number | null | undefined, unknown: string): string {
  return value === null || value === undefined || value === '' ? unknown : String(value)
}

function resources(value: Readonly<Record<string, number>>): string {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, amount]) => `${name}=${amount}`).join(', ')
}

function formatScore(value: number | null | undefined, unknown: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown
  return value.toFixed(3)
}

function formatDelta(value: number | null, unknown: string): string {
  if (value === null || !Number.isFinite(value)) return unknown
  return `${value > 0 ? '+' : ''}${value.toFixed(3)}`
}

function shortVersion(value: string | null | undefined, unknown: string): string {
  if (value === null || value === undefined || value === '') return unknown
  return value.length > 16 ? value.slice(0, 12) : value
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(timestamp)
}

function TrajectoryLane({
  run, document, trajectoryError, loadRaw, closeRaw, raw,
  loadInteractions, closeInteractions, interactions, dshTrajectory, t,
}: {
  readonly run: RefinementRunView
  readonly document: ReturnType<RefinementController['getSnapshot']>['trajectories'][string] | undefined
  readonly trajectoryError: string | undefined
  readonly loadRaw: (cursor: string | null) => void
  readonly closeRaw: () => void
  readonly raw: RefinementProviderEvidencePage | null
  readonly loadInteractions: (cursor: string | null) => void
  readonly closeInteractions: () => void
  readonly interactions: RefinementInteractionEvidencePage | null
  readonly dshTrajectory: DshTrajectoryBridge
  readonly t: (key: RefinementKey) => string
}) {
  const observation = run.observation.state === 'valid'
    ? String(run.observation.reward)
    : run.observation.state === 'invalid'
      ? `${t('comparison.invalid')}: ${run.observation.reason}`
      : t('unknown')
  const duration = run.startedAt === undefined || run.completedAt === undefined
    ? null
    : run.completedAt - run.startedAt
  return (
    <section className={css.lane} data-run-id={run.id}>
      <div className={css.laneHeader}>
        <div className={css.row}>
          <strong>{run.harness.id}</strong>
          <span className={css.pill} title={run.harness.revisionIdentity ?? run.harness.requestedRef}>
            {shortVersion(run.harness.revisionIdentity ?? run.harness.requestedRef, t('unknown'))}
          </span>
          <span className={css.pill}>#{run.attempt}</span>
          {run.phase && <span className={css.pill}>{t('trajectory.phase')} {run.phase.index}/{run.phase.count}</span>}
        </div>
        <span>{run.model.effectiveId ?? run.model.requestedId}</span>
        <div className={css.facts}>
          <span className={css.fact}><span className={css.factLabel}>{t('comparison.reward')}</span>{observation}</span>
          <span className={css.fact}><span className={css.factLabel}>{t('comparison.duration')}</span>{duration === null ? t('unknown') : `${duration} ms`}</span>
          <span className={css.fact}><span className={css.factLabel}>{t('state')}</span>{statusLabel(run.execution, t)}</span>
        </div>
        {run.trajectory.summary !== undefined && (
          <div className={css.row}>
            <span>{t('comparison.tools')} {display(run.trajectory.summary.toolCalls, t('unknown'))}</span>
            <span>{t('comparison.tokens')} {display(run.trajectory.summary.inputTokens, t('unknown'))}/{display(run.trajectory.summary.outputTokens, t('unknown'))}</span>
            <span>{t('comparison.ttft')} {display(run.trajectory.summary.ttftMs, t('unknown'))}</span>
          </div>
        )}
        <details className="rear-lane-metadata">
          <summary>{t('trajectory.metadata')}</summary>
          {run.executionEvidence !== undefined && (
            <div className={css.row}>
              <span>{t('execution.provider')} {run.executionEvidence.provider}</span>
              <span>{t('execution.worker')} {display(run.executionEvidence.workerId, t('unknown'))}</span>
              <span>{t('execution.lease')} {display(run.executionEvidence.leaseId, t('unknown'))}</span>
              {run.executionEvidence.requestedResources !== undefined && (
                <span>{t('execution.requested')} {resources(run.executionEvidence.requestedResources)}</span>
              )}
              {run.executionEvidence.observedResources !== undefined && (
                <span>{t('execution.observed')} {resources(run.executionEvidence.observedResources)}</span>
              )}
              <span title={run.executionEvidence.images.map(image => `${image.reference} (${image.imageDigest})`).join('\n')}>
                {t('execution.images')} {run.executionEvidence.images.length}
              </span>
            </div>
          )}
          {run.capture !== undefined && (
            <div className={css.row}>
              <span>{t('capture.title')} {run.capture.mode}</span>
              <span>{t('capture.completeness')} {run.capture.completeness}</span>
              <span>{t('capture.interactions')} {run.capture.interactionCount}</span>
              <span>{t('capture.redaction')} {run.capture.redaction.status}</span>
            </div>
          )}
          <span className={css.muted}>{t('comparison.eval')} {run.evalId} · {t('comparison.trial')} {run.trialId} · {t('comparison.protocol')} {run.protocolIdentity}</span>
        </details>
        {run.trajectory.providerFileCount > 0 && (
          <button
            type="button"
            aria-expanded={raw !== null}
            onClick={() => { if (raw === null) loadRaw(null); else closeRaw() }}
          >{raw === null ? t('evidence.raw') : t('evidence.hide')}</button>
        )}
        {run.capture?.interactionAvailable === true && (
          <button
            type="button"
            aria-expanded={interactions !== null}
            onClick={() => { if (interactions === null) loadInteractions(null); else closeInteractions() }}
          >{interactions === null ? t('evidence.interactions') : t('evidence.hideInteractions')}</button>
        )}
      </div>
      <div className={css.laneBody}>
        <VerifierEvidenceView run={run} t={t} />
        {raw !== null && (
          <div>
            <pre className={css.raw}>{raw.content}</pre>
            {raw.nextCursor !== null && (
              <button type="button" onClick={() => { loadRaw(raw.nextCursor) }}>{t('evidence.next')}</button>
            )}
          </div>
        )}
        {interactions !== null && (
          <div>
            <pre className={css.raw}>{interactions.content}</pre>
            {interactions.nextCursor !== null && (
              <button type="button" onClick={() => { loadInteractions(interactions.nextCursor) }}>{t('evidence.nextInteractions')}</button>
            )}
          </div>
        )}
        {document === undefined
          ? <div className={css.empty}>{t('loading')}</div>
          : document === null
            ? <div className={css.empty}>{trajectoryError ?? `${run.trajectory.availability} · ${t('trajectory.empty')}`}</div>
            : <DshOfflineTrajectorySurface
                bridge={dshTrajectory}
                document={document}
              />}
      </div>
    </section>
  )
}

/** Always-present Refine conversation view with overview, evaluation, and comparison levels. */
export function RefinementView({
  useRefinement, ensure, selectRefinement, selectIteration, selectRuns, back,
  loadProviderEvidence, closeProviderEvidence, loadInteractionEvidence, closeInteractionEvidence, dshTrajectory, analysis, nativeChat, t,
}: ViewProps) {
  const state = useRefinement(value => value)
  const [dismissedEvaluations, setDismissedEvaluations] = useState<readonly string[]>([])
  const [toolView, setToolView] = useState<'traces' | 'diff'>('traces')
  useEffect(() => { void ensure() }, [ensure])
  useEffect(() => { setDismissedEvaluations([]) }, [state.detail?.id])

  if (state.status === 'cold' || (state.status === 'loading' && state.detail === null)) {
    return <main className={css.root}><div className={css.empty}>{t('loading')}</div></main>
  }
  if (state.records.length === 0 && state.detail === null) {
    return (
      <main className={css.root}>
        <div className={css.empty}>
          <span className={css.brandMark}>R</span>
          <h2>{t('empty.title')}</h2>
          <p className={css.muted}>{t('empty.body')}</p>
          {state.error !== null && <p className={css.error}>{state.error}</p>}
        </div>
      </main>
    )
  }

  const detail = state.detail
  const selectedIteration = detail?.iterations.find(iteration => iteration.id === state.selectedIterationId) ?? null
  const selectedEvaluation = state.selectedIterationId === null
    ? state.evaluation
    : state.evaluationHistory[state.selectedIterationId] ?? state.evaluation
  const currentBenchmarkRef = selectedEvaluation?.evaluations[0]?.ref ?? selectedIteration?.evaluationRefs[0] ?? null
  const overviewTable = experimentCombinationTable(
    detail?.iterations ?? [],
    detail?.candidates ?? [],
    detail?.baselineCandidateId ?? null,
    state.evaluationHistory,
  )
  const bestCombinationRow = overviewTable.leadingRow
  const best = bestCombinationRow?.cells.find(cell => cell.score !== null)?.score ?? null
  const bestCandidate = detail?.candidates.find(candidate => candidate.id === best?.candidateId) ?? null
  const bestCoverage = bestCombinationRow === null ? null : {
    completed: bestCombinationRow.coverageCompleted,
    total: bestCombinationRow.coverageTotal,
  }

  if (state.level === 'overview') {
    if (detail === null) return <main className={css.root}><div className={css.empty}>{t('loading')}</div></main>
    const benchmarkId = overviewTable.benchmarks.length > 1
      ? t('portfolio.title')
      : currentBenchmarkRef?.benchmarkId ?? t('unknown')
    const benchmarkRevision = overviewTable.benchmarks.length > 1
      ? String(overviewTable.benchmarks.length)
      : currentBenchmarkRef?.benchmarkRevision ?? t('unknown')
    const canOpen = state.selectedIterationId !== null
    return (
      <main className={css.root}>
        <header className={css.topbar}>
          <div className={css.brand}><span className={css.brandMark}>R</span><span>{t('view.refinement')}</span></div>
          <span className={css.status} data-status={detail.status}><span />{statusLabel(detail.status, t)}</span>
        </header>
        {state.error !== null && <p className={css.error}>{state.error}</p>}
        <section className={css.hero}>
          <div className={css.heroCopy}>
            <span className={css.kicker}>{t('overview.kicker')}</span>
            <h1 className={css.heroTitle}>{benchmarkId}</h1>
            <p className={css.muted}>{display(detail.objective, t('unknown'))}</p>
            <div className={css.heroCombo}>
              <span className={css.scoreLabel}>{t('overview.leadingCombination')}</span>
              {best === null ? (
                <strong className={css.comboPrimary}>{t('overview.noScore')}</strong>
              ) : (
                <>
                  <div className={css.row}>
                    <strong className={css.comboPrimary}>{best.harnessId}</strong>
                    <span className={css.comboJoin}>×</span>
                    <strong className={css.comboPrimary}>{best.modelId}</strong>
                  </div>
                  <div className={css.row}>
                    <span className={css.pill} title={best.revision ?? best.harnessRef}>
                      {t('overview.harnessVersion')} · {shortVersion(best.revision ?? best.harnessRef, t('unknown'))}
                    </span>
                    {bestCandidate !== null && <span className={css.pill}>{bestCandidate.label}</span>}
                    {(best.provisional || bestCombinationRow?.status !== 'complete') && (
                      <span className={css.pill} data-tone="warning">{t('overview.provisional')}</span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className={css.facts}>
              <span className={css.fact}>
                <span className={css.factLabel}>{overviewTable.benchmarks.length > 1 ? t('portfolio.benchmarks') : t('overview.benchmarkVersion')}</span>
                {benchmarkRevision}
              </span>
              <span className={css.fact}>
                <span className={css.factLabel}>{overviewTable.benchmarks.length > 1 ? t('table.coverage') : t('breakdown.taskCoverage')}</span>
                {overviewTable.benchmarks.length > 1
                  ? bestCombinationRow === null ? t('unknown') : `${bestCombinationRow.coverageCompleted}/${display(bestCombinationRow.coverageTotal, '?')}`
                  : best === null ? t('unknown') : `${best.taskCount}/${display(best.plannedTaskCount, '?')}`}
              </span>
              <span className={css.fact}>
                <span className={css.factLabel}>{t('overview.updated')}</span>
                {formatTime(detail.updatedAt)}
              </span>
            </div>
            <div className={css.row}>
              <button
                type="button"
                className={css.action}
                disabled={!canOpen}
                onClick={() => { if (state.selectedIterationId !== null) void selectIteration(state.selectedIterationId) }}
              >{t('overview.openBreakdown')} <span aria-hidden="true">→</span></button>
            </div>
          </div>
          <div className={css.heroScore}>
            <span className={css.scoreLabel}>{overviewTable.benchmarks.length > 1 ? t('portfolio.meanReward') : t('overview.bestScore')}</span>
            <strong className={css.scoreValue}>{bestCombinationRow === null ? '—' : formatScore(bestCombinationRow.meanScore, t('unknown'))}</strong>
            {bestCombinationRow !== null && (
              <span className={css.muted}>
                {formatDelta(bestCombinationRow.meanDelta, '—')} {t('portfolio.meanDelta')} · {bestCoverage?.completed}/{display(bestCoverage?.total, '?')}
              </span>
            )}
          </div>
        </section>
        {detail.failure !== undefined && <p className={css.error}>{detail.failure.code}: {detail.failure.message}</p>}
        <section className={css.section}>
          <div className={css.sectionHeader}>
            <div><span className={css.kicker}>{t('overview.history')}</span><h2>{t('overview.title')}</h2></div>
            <span className={css.muted}>{state.records.length}</span>
          </div>
          <div className={css.history}>
            {state.records.map(record => (
              <button
                type="button"
                className={css.historyItem}
                data-selected={record.id === detail.id}
                aria-current={record.id === detail.id ? 'true' : undefined}
                key={record.id}
                onClick={() => { void selectRefinement(record.id) }}
              >
                <span className={css.historyMain}>
                  <strong>{display(record.objective, t('unknown'))}</strong>
                  <span className={css.historyMeta}>{record.iterationCount} {t('iterations')} · {formatTime(record.updatedAt)}</span>
                </span>
                <span className={css.status} data-status={record.status}><span />{statusLabel(record.status, t)}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    )
  }

  if (state.level === 'evaluation') {
    if (detail === null) return <main className={css.root}><div className={css.empty}>{t('loading')}</div></main>
    return (
      <main className={css.root}>
        <header className={css.header}>
          <button type="button" className={css.backButton} onClick={back} aria-label={t('back')}>←</button>
          <div className={css.breadcrumb}>
            <span className={css.kicker}>{t('breakdown.kicker')}</span>
            <h2>{display(detail.objective, t('unknown'))}</h2>
            <span className={css.muted}>{detail.id} · {formatTime(detail.updatedAt)}</span>
          </div>
          <span className={css.status} data-status={detail.status}><span />{statusLabel(detail.status, t)}</span>
        </header>
        {state.error !== null && <p className={css.error}>{state.error}</p>}
        {detail.failure !== undefined && <p className={css.error}>{detail.failure.code}: {detail.failure.message}</p>}
        {activeExperimentEvaluations(state.evaluationHistory).filter(evaluation => !dismissedEvaluations.includes(evaluation.ref.evalId)).map(evaluation => (
          <div key={evaluation.ref.evalId} className={css.meta}>
            <span>{evaluation.ref.evalId}</span>
            <span>{t('status')} {statusLabel(evaluation.status, t)}</span>
            {evaluation.phase !== undefined && <span>{t('evaluation.phase')} {evaluation.phase}</span>}
            <span>{t('evaluation.progress')} {evaluation.settledTasks}/{display(evaluation.plannedTasks, t('unknown'))}</span>
            <button type="button" aria-label={`${t('table.close')} ${evaluation.ref.evalId}`} onClick={() => { setDismissedEvaluations(current => [...current, evaluation.ref.evalId]) }}>×</button>
            {evaluation.diagnostics.map((diagnostic, ordinal) => (
              <span key={`${diagnostic.code}-${ordinal}`} className={css.error}>{diagnostic.code}: {diagnostic.message}</span>
            ))}
          </div>
        ))}
        {Object.keys(state.evaluationHistory).length === 0
          ? <div className={css.empty}>{t('loading')}</div>
          : <ExperimentTablesView detail={detail} evaluationHistory={state.evaluationHistory} onSelectRuns={selectRuns} t={t} />}
      </main>
    )
  }

  const allRuns = experimentHistoryRuns(state.evaluationHistory)
  const runById = new Map(allRuns.map(run => [run.id, run]))
  const selectedRuns = state.selectedRunIds.flatMap(id => {
    const run = runById.get(id)
    return run === undefined ? [] : [run]
  })
  const selectedProtocols = new Set(selectedRuns.map(run => runAggregationIdentity(run)))
  const selectedHarnesses = new Set(selectedRuns.map(run => `${run.harness.id}\u0000${run.harness.revisionIdentity ?? ''}`))
  const selectedModels = new Set(selectedRuns.map(run => `${run.model.provider ?? ''}\u0000${run.model.effectiveId ?? run.model.requestedId}`))
  const matchesFixedDimension = (run: RefinementRunView): boolean => {
    if (selectedRuns.length === 0) return true
    const harness = `${run.harness.id}\u0000${run.harness.revisionIdentity ?? ''}`
    const model = `${run.model.provider ?? ''}\u0000${run.model.effectiveId ?? run.model.requestedId}`
    if (selectedHarnesses.size > 1) return selectedModels.has(model)
    if (selectedModels.size > 1) return selectedHarnesses.has(harness)
    return selectedHarnesses.has(harness) || selectedModels.has(model)
  }
  const selectableRuns = allRuns.filter(run => run.taskKey === state.selectedTaskKey
    && (selectedProtocols.size === 0 || selectedProtocols.has(runAggregationIdentity(run)))
    && matchesFixedDimension(run)
    && (run.trajectory.availability === 'available' || run.trajectory.availability === 'provider-only'))
    .sort((left, right) => left.harness.id.localeCompare(right.harness.id) || left.attempt - right.attempt)
  const selectedTaskId = selectedRuns[0]?.taskId ?? state.selectedTaskKey
  return (
    <main className={`${css.root} rear-comparison-workbench`}>
      <header className={css.header}>
        <button type="button" className={css.backButton} onClick={back} aria-label={t('back')}>←</button>
        <div className={css.comparisonHead}>
          <span className={css.kicker}>{t('comparison.title')}</span>
          <h2>{selectedTaskId ?? t('unknown')}</h2>
          {state.attemptPairing === 'unpaired' && <span className={css.pill} data-tone="warning">{t('unpaired')}</span>}
        </div>
      </header>
      {state.error !== null && <p className={css.error}>{state.error}</p>}
      <TraceWorkbench t={t} panel={close => detail !== null && <TraceAnalysisPanel controller={analysis} nativeChat={nativeChat}
        refinementId={detail.id} runs={selectedRuns} t={t} onClose={close} />}>
        <div className="rear-workbench-tabs" role="tablist" aria-label={t('workbench.tabs')}>
          {(['traces', 'diff'] as const).map(view => <button type="button" role="tab" key={view} id={`rear-tab-${view}`}
            aria-controls={`rear-panel-${view}`} aria-selected={toolView === view}
            onClick={() => setToolView(view)}>{t(`workbench.${view}`)}</button>)}
        </div>
        <div className="rear-evidence-scroll">
          <details className={`${css.runPicker} rear-run-selection`}>
            <summary>{t('comparison.chooseRuns')}<span className={css.pill}>{state.selectedRunIds.length}/4</span></summary>
            <div className={css.runGrid}>
              {selectableRuns.map(run => {
                const selected = state.selectedRunIds.includes(run.id)
                const disabled = selected ? state.selectedRunIds.length <= 1 : state.selectedRunIds.length >= 4
                const observation = run.observation.state === 'valid'
                  ? formatScore(run.observation.reward, t('unknown'))
                  : statusLabel(run.observation.state, t)
                return (
                  <label className={css.runOption} data-selected={selected} data-disabled={disabled} key={run.id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => {
                        const next = selected
                          ? state.selectedRunIds.filter(id => id !== run.id)
                          : [...state.selectedRunIds, run.id]
                        if (next.length >= 1 && next.length <= 4) void selectRuns(next)
                      }}
                    />
                    <span className={css.runOptionTop}>
                      <strong>{run.harness.id}</strong>
                      <span className={css.pill}>#{run.attempt}</span>
                    </span>
                    <span>{run.model.effectiveId ?? run.model.requestedId}</span>
                    <span className={css.muted}>{shortVersion(run.harness.revisionIdentity ?? run.harness.requestedRef, t('unknown'))} · {t('comparison.reward')} {observation}</span>
                  </label>
                )
              })}
            </div>
          </details>
          <div role="tabpanel" id="rear-panel-diff" aria-labelledby="rear-tab-diff" hidden={toolView !== 'diff'}>
            <BlockComparison
              key={analysisScopeKey({ refinementId: detail?.id ?? '', runIds: selectedRuns.map(run => run.id) })}
              runs={selectedRuns} documents={state.trajectories} errors={state.trajectoryErrors} t={t}
            />
          </div>
          <div role="tabpanel" id="rear-panel-traces" aria-labelledby="rear-tab-traces" hidden={toolView !== 'traces'}>
            <div className={css.lanes}>
              {state.selectedRunIds.map((runId) => {
                const run = runById.get(runId)
                if (run === undefined) return null
                return (
                  <TrajectoryLane
                    key={runId}
                    t={t}
                    dshTrajectory={dshTrajectory}
                    run={run}
                    document={state.trajectories[runId]}
                    trajectoryError={state.trajectoryErrors[runId]}
                    loadRaw={(cursor) => { void loadProviderEvidence(runId, 0, cursor) }}
                    closeRaw={() => { closeProviderEvidence(runId) }}
                    raw={state.providerEvidence?.runId === runId ? state.providerEvidence : null}
                    loadInteractions={(cursor) => { void loadInteractionEvidence(runId, cursor) }}
                    closeInteractions={() => { closeInteractionEvidence(runId) }}
                    interactions={state.interactionEvidence?.runId === runId ? state.interactionEvidence : null}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </TraceWorkbench>
    </main>
  )
}
