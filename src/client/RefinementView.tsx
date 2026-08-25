import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CommandRowProps,
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RefinementEvaluationView,
  RefinementId,
  RefinementIterationId,
  RefinementProviderEvidencePage,
  RefinementRunView,
} from '../types.ts'
import type { RefinementController } from './controller.ts'
import { en, type RefinementKey } from './locales.ts'
import { OfflineTrajectorySurface } from './OfflineTrajectorySurface.tsx'
import type { RefinementLinksSnapshot } from './refinement-links.ts'

const css = {
  root: 'rear-refinement-root', header: 'rear-refinement-header', list: 'rear-refinement-list',
  card: 'rear-refinement-card', row: 'rear-refinement-row', muted: 'rear-refinement-muted',
  error: 'rear-refinement-error', meta: 'rear-refinement-meta', table: 'rear-refinement-table',
  attempt: 'rear-refinement-attempt', lanes: 'rear-refinement-lanes', lane: 'rear-refinement-lane',
  laneHeader: 'rear-refinement-lane-header', laneBody: 'rear-refinement-lane-body',
  raw: 'rear-refinement-raw', command: 'rear-refinement-command', commandText: 'rear-refinement-command-text',
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
} as const

const EMPTY_LINKS: RefinementLinksSnapshot = new Map()

/** Controller and layout actions shared by the view and command card. */
export interface RefinementInjected {
  hooks: { refinement: RefinementController }
  ensure: () => Promise<void>
  selectRefinement: (refinementId: RefinementId) => Promise<void>
  selectIteration: RefinementController['selectIteration']
  setComparisonDimension: RefinementController['setComparisonDimension']
  openTask: RefinementController['openTask']
  selectRuns: RefinementController['selectRuns']
  back: RefinementController['back']
  cancel: RefinementController['cancel']
  loadProviderEvidence: RefinementController['loadProviderEvidence']
  closeProviderEvidence: RefinementController['closeProviderEvidence']
  closeDetails: () => void
}

type ViewProps = ConvViewProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'>
type CardProps = CommandRowProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'> & {
  readonly openView?: (viewId: string) => void
}

const ENGLISH_T = (key: RefinementKey): string => en[key]

const STATUS_KEYS = {
  queued: 'status.queued', preparing: 'status.preparing', evaluating: 'status.evaluating', settled: 'status.settled',
  running: 'status.running', 'awaiting-review': 'status.awaitingReview', completed: 'status.completed',
  succeeded: 'status.succeeded', failed: 'status.failed', 'timed-out': 'status.timedOut', cancelled: 'status.cancelled',
  corrupt: 'status.corrupt', pending: 'status.pending', regressed: 'status.regressed', invalid: 'status.invalid',
  improved: 'status.improved', unchanged: 'status.unchanged', valid: 'status.valid', missing: 'status.missing',
} as const

function statusLabel(status: string, t: (key: RefinementKey) => string): string {
  const key = STATUS_KEYS[status as keyof typeof STATUS_KEYS]
  return key === undefined ? status : t(key)
}

function roleLabel(role: string, t: ViewProps['t']): string {
  return role === 'baseline' ? t('baseline') : role === 'candidate' ? t('candidate') : role
}

function display(value: string | number | null | undefined, unknown: string): string {
  return value === null || value === undefined || value === '' ? unknown : String(value)
}

function attemptLabel(run: RefinementRunView, t: ViewProps['t']): string {
  const observation = run.observation.state === 'valid'
    ? String(run.observation.reward)
    : run.observation.state === 'invalid'
      ? `${t('comparison.invalid')}: ${run.observation.reason}`
      : t('unknown')
  return `#${run.attempt} · ${statusLabel(run.execution, t)} · ${observation}`
}

interface CombinationScore {
  readonly key: string
  readonly iterationId: RefinementIterationId
  readonly candidateId: string
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  readonly harnessId: string
  readonly harnessRef: string
  readonly revision: string | null
  readonly modelId: string
  readonly provider: string | null
  readonly protocolIdentity: string
  readonly mean: number
  readonly taskCount: number
  readonly plannedTaskCount: number | null
  readonly runCount: number
  readonly provisional: boolean
}

function combinationScores(
  iterationId: RefinementIterationId,
  evaluation: RefinementEvaluationView | null,
): readonly CombinationScore[] {
  if (evaluation === null) return []
  const groups = new Map<string, {
    candidateId: string
    benchmarkId: string
    benchmarkRevision: string
    harnessId: string
    harnessRef: string
    revision: string | null
    modelId: string
    provider: string | null
    protocolIdentity: string
    tasks: Map<string, number[]>
    plannedTaskCounts: number[]
    runCount: number
  }>()
  for (const item of evaluation.evaluations) {
    for (const run of item.runs) {
      if (run.integrity !== 'valid' || run.observation.state !== 'valid') continue
      const modelId = run.model.effectiveId ?? run.model.requestedId
      const key = [
        run.candidateId,
        item.ref.benchmarkId,
        item.ref.benchmarkRevision,
        run.harness.id,
        run.harness.revisionIdentity ?? '',
        modelId,
        run.protocolIdentity,
      ].join('\u0000')
      const group = groups.get(key) ?? {
        candidateId: run.candidateId,
        benchmarkId: item.ref.benchmarkId,
        benchmarkRevision: item.ref.benchmarkRevision,
        harnessId: run.harness.id,
        harnessRef: run.harness.requestedRef,
        revision: run.harness.revisionIdentity,
        modelId,
        provider: run.model.provider,
        protocolIdentity: run.protocolIdentity,
        tasks: new Map<string, number[]>(),
        plannedTaskCounts: [],
        runCount: 0,
      }
      const rewards = group.tasks.get(run.taskKey) ?? []
      rewards.push(run.observation.reward)
      group.tasks.set(run.taskKey, rewards)
      if (item.plannedTasks !== null) group.plannedTaskCounts.push(item.plannedTasks)
      group.runCount += 1
      groups.set(key, group)
    }
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const taskMeans = [...group.tasks.values()].map(rewards => rewards.reduce((sum, value) => sum + value, 0) / rewards.length)
    if (taskMeans.length === 0) return []
    const plannedTaskCount = group.plannedTaskCounts.length === 0 ? null : Math.max(...group.plannedTaskCounts)
    return [{
      key,
      iterationId,
      candidateId: group.candidateId,
      benchmarkId: group.benchmarkId,
      benchmarkRevision: group.benchmarkRevision,
      harnessId: group.harnessId,
      harnessRef: group.harnessRef,
      revision: group.revision,
      modelId: group.modelId,
      provider: group.provider,
      protocolIdentity: group.protocolIdentity,
      mean: taskMeans.reduce((sum, value) => sum + value, 0) / taskMeans.length,
      taskCount: taskMeans.length,
      plannedTaskCount,
      runCount: group.runCount,
      provisional: plannedTaskCount === null || taskMeans.length < plannedTaskCount,
    }]
  }).sort((left, right) => Number(left.provisional) - Number(right.provisional)
    || right.mean - left.mean
    || right.taskCount - left.taskCount)
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

function validMean(runs: readonly RefinementRunView[]): number | null {
  const rewards = runs.flatMap(run => run.integrity === 'valid' && run.observation.state === 'valid'
    ? [run.observation.reward]
    : [])
  return rewards.length === 0 ? null : rewards.reduce((sum, value) => sum + value, 0) / rewards.length
}

function TrajectoryLane({ run, document, loadRaw, closeRaw, raw }: {
  readonly run: RefinementRunView
  readonly document: ReturnType<RefinementController['getSnapshot']>['trajectories'][string] | undefined
  readonly loadRaw: (cursor: string | null) => void
  readonly closeRaw: () => void
  readonly raw: RefinementProviderEvidencePage | null
}) {
  const observation = run.observation.state === 'valid'
    ? String(run.observation.reward)
    : run.observation.state === 'invalid'
      ? `${ENGLISH_T('comparison.invalid')}: ${run.observation.reason}`
      : ENGLISH_T('unknown')
  const duration = run.startedAt === undefined || run.completedAt === undefined
    ? null
    : run.completedAt - run.startedAt
  return (
    <section className={css.lane} data-run-id={run.id}>
      <div className={css.laneHeader}>
        <div className={css.row}>
          <strong>{run.harness.id}</strong>
          <span className={css.pill} title={run.harness.revisionIdentity ?? run.harness.requestedRef}>
            {shortVersion(run.harness.revisionIdentity ?? run.harness.requestedRef, ENGLISH_T('unknown'))}
          </span>
          <span className={css.pill}>#{run.attempt}</span>
        </div>
        <span>{run.model.effectiveId ?? run.model.requestedId}</span>
        <div className={css.facts}>
          <span className={css.fact}><span className={css.factLabel}>{ENGLISH_T('comparison.reward')}</span>{observation}</span>
          <span className={css.fact}><span className={css.factLabel}>{ENGLISH_T('comparison.duration')}</span>{duration === null ? ENGLISH_T('unknown') : `${duration} ms`}</span>
          <span className={css.fact}><span className={css.factLabel}>{ENGLISH_T('state')}</span>{statusLabel(run.execution, ENGLISH_T)}</span>
        </div>
        {run.trajectory.summary !== undefined && (
          <div className={css.row}>
            <span>{ENGLISH_T('comparison.tools')} {display(run.trajectory.summary.toolCalls, ENGLISH_T('unknown'))}</span>
            <span>{ENGLISH_T('comparison.tokens')} {display(run.trajectory.summary.inputTokens, ENGLISH_T('unknown'))}/{display(run.trajectory.summary.outputTokens, ENGLISH_T('unknown'))}</span>
            <span>{ENGLISH_T('comparison.ttft')} {display(run.trajectory.summary.ttftMs, ENGLISH_T('unknown'))}</span>
          </div>
        )}
        <span className={css.muted}>{ENGLISH_T('comparison.eval')} {run.evalId} · {ENGLISH_T('comparison.trial')} {run.trialId} · {ENGLISH_T('comparison.protocol')} {run.protocolIdentity}</span>
        {run.trajectory.providerFileCount > 0 && (
          <button
            type="button"
            aria-expanded={raw !== null}
            onClick={() => { if (raw === null) loadRaw(null); else closeRaw() }}
          >{raw === null ? ENGLISH_T('evidence.raw') : ENGLISH_T('evidence.hide')}</button>
        )}
      </div>
      <div className={css.laneBody}>
        {raw !== null && (
          <div>
            <pre className={css.raw}>{raw.content}</pre>
            {raw.nextCursor !== null && (
              <button type="button" onClick={() => { loadRaw(raw.nextCursor) }}>{ENGLISH_T('evidence.next')}</button>
            )}
          </div>
        )}
        {document === undefined
          ? <div className={css.empty}>{ENGLISH_T('loading')}</div>
          : document === null
            ? <div className={css.empty}>{run.trajectory.availability} · {ENGLISH_T('trajectory.empty')}</div>
            : <OfflineTrajectorySurface
                document={document}
                t={ENGLISH_T}
              />}
      </div>
    </section>
  )
}

/** Always-present Refine conversation view with overview, evaluation, and comparison levels. */
export function RefinementView({
  useRefinement, ensure, selectRefinement, selectIteration, setComparisonDimension, openTask, selectRuns, back, cancel,
  loadProviderEvidence, closeProviderEvidence, closeDetails, t,
}: ViewProps) {
  const state = useRefinement(value => value)
  const [taskFilter, setTaskFilter] = useState<'all' | 'improved' | 'regressed' | 'unchanged'>('all')
  useEffect(() => { void ensure() }, [ensure])

  if (state.status === 'cold' || state.status === 'loading') {
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
  const currentBenchmarkRef = state.evaluation?.evaluations[0]?.ref ?? selectedIteration?.evaluationRefs[0] ?? null
  const rankedScores = Object.entries(state.evaluationHistory)
    .flatMap(([iterationId, evaluation]) => combinationScores(iterationId as RefinementIterationId, evaluation))
    .filter(item => currentBenchmarkRef === null
      || (item.benchmarkId === currentBenchmarkRef.benchmarkId
        && item.benchmarkRevision === currentBenchmarkRef.benchmarkRevision))
    .sort((left, right) => Number(left.provisional) - Number(right.provisional)
      || right.mean - left.mean
      || right.taskCount - left.taskCount)
  const best = rankedScores[0] ?? null
  const bestCandidate = detail?.candidates.find(candidate => candidate.id === best?.candidateId) ?? null

  if (state.level === 'overview') {
    if (detail === null) return <main className={css.root}><div className={css.empty}>{t('loading')}</div></main>
    const benchmarkId = currentBenchmarkRef?.benchmarkId ?? t('unknown')
    const benchmarkRevision = currentBenchmarkRef?.benchmarkRevision ?? t('unknown')
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
                    {best.provisional && <span className={css.pill} data-tone="warning">{t('overview.provisional')}</span>}
                  </div>
                </>
              )}
            </div>
            <div className={css.facts}>
              <span className={css.fact}>
                <span className={css.factLabel}>{t('overview.benchmarkVersion')}</span>
                {benchmarkRevision}
              </span>
              <span className={css.fact}>
                <span className={css.factLabel}>{t('breakdown.taskCoverage')}</span>
                {best === null ? t('unknown') : `${best.taskCount}/${display(best.plannedTaskCount, t('unknown'))}`}
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
              {!['completed', 'failed', 'cancelled'].includes(detail.status) && (
                <button type="button" className={css.secondary} onClick={() => { void cancel() }}>{t('cancel')}</button>
              )}
            </div>
          </div>
          <div className={css.heroScore}>
            <span className={css.scoreLabel}>{t('overview.bestScore')}</span>
            <strong className={css.scoreValue}>{best === null ? '—' : formatScore(best.mean, t('unknown'))}</strong>
            {best !== null && (
              <span className={css.muted}>
                {best.runCount} {t('breakdown.validRuns')} · {best.taskCount} {t('task')}
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
    const evaluation = state.evaluation
    const currentScores = state.selectedIterationId === null
      ? []
      : combinationScores(state.selectedIterationId, evaluation)
    const allRuns = evaluation?.evaluations.flatMap(item => item.runs) ?? []
    const directionIds = [...new Set(evaluation?.evaluations.map(item => item.ref.candidateId) ?? [])]
    const directions = directionIds.map((candidateId) => {
      const candidate = detail?.candidates.find(item => item.id === candidateId) ?? null
      return {
        id: candidateId,
        label: candidate?.label ?? String(candidateId),
        role: candidate?.role ?? 'candidate',
        harnessRef: candidate?.requestedHarnessRef ?? t('unknown'),
        revision: candidate?.revisionIdentity ?? null,
        score: currentScores.find(item => item.candidateId === candidateId) ?? null,
      }
    })
    const comparisonByTask = new Map(evaluation?.comparison.tasks.map(task => [task.taskKey, task]) ?? [])
    const taskIdentity = new Map<string, string>()
    for (const run of allRuns) taskIdentity.set(run.taskKey, run.taskId)
    const statusOrder = { regressed: 0, invalid: 1, improved: 2, unchanged: 3, pending: 4 } as const
    const tasks = [...taskIdentity.entries()].map(([taskKey, taskId]) => ({
      taskKey,
      taskId,
      comparison: comparisonByTask.get(taskKey) ?? null,
    })).filter(item => taskFilter === 'all' || item.comparison?.status === taskFilter)
      .sort((left, right) => (statusOrder[left.comparison?.status ?? 'pending'] - statusOrder[right.comparison?.status ?? 'pending'])
        || left.taskId.localeCompare(right.taskId))
    const validRuns = allRuns.filter(run => run.integrity === 'valid' && run.observation.state === 'valid').length
    const bestCurrent = currentScores[0] ?? null
    const benchmark = evaluation?.evaluations[0]?.ref ?? currentBenchmarkRef
    return (
      <main className={css.root}>
        <header className={css.header}>
          <button type="button" className={css.backButton} onClick={back} aria-label={t('back')}>←</button>
          <div className={css.breadcrumb}>
            <span className={css.kicker}>{t('breakdown.kicker')}</span>
            <h2>{benchmark?.benchmarkId ?? display(detail?.objective, t('unknown'))}</h2>
            <span className={css.muted}>
              {benchmark?.benchmarkRevision ?? t('unknown')}
              {bestCurrent !== null && ` · ${formatScore(bestCurrent.mean, t('unknown'))} · ${bestCurrent.harnessId}`}
            </span>
          </div>
          <div className={css.segment} aria-label={t('state')}>
            <button type="button" disabled={state.comparisonDimension === 'harness'} onClick={() => { void setComparisonDimension('harness') }}>{t('dimension.harness')}</button>
            <button type="button" disabled={state.comparisonDimension === 'model'} onClick={() => { void setComparisonDimension('model') }}>{t('dimension.model')}</button>
          </div>
        </header>
        {state.error !== null && <p className={css.error}>{state.error}</p>}
        {detail !== null && detail.iterations.length > 0 && (
          <nav className={css.iterationNav} aria-label={t('iterations')}>
            {detail.iterations.slice().reverse().map(iteration => (
              <button
                type="button"
                data-selected={iteration.id === state.selectedIterationId}
                key={iteration.id}
                onClick={() => { void selectIteration(iteration.id) }}
              >
                {t('breakdown.iteration')} {String(iteration.ordinal).padStart(2, '0')}
                <span>{statusLabel(iteration.status, t)}</span>
              </button>
            ))}
          </nav>
        )}
        {evaluation === null ? <div className={css.empty}>{t('loading')}</div> : (
          <>
            <section className={css.section}>
              <div className={css.sectionHeader}>
                <div><span className={css.kicker}>01</span><h2>{t('breakdown.experiments')}</h2></div>
              </div>
              <div className={css.directions}>
                {directions.map(direction => (
                  <article className={css.direction} data-role={direction.role} key={direction.id}>
                    <div className={css.directionTop}>
                      <span className={css.pill}>{roleLabel(direction.role, t)}</span>
                      {direction.score?.key === bestCurrent?.key && <span className={css.pill} data-tone="best">{t('breakdown.best')}</span>}
                    </div>
                    <div>
                      <h3>{direction.label}</h3>
                      <p className={css.muted}>{direction.score?.harnessId ?? direction.harnessRef} × {direction.score?.modelId ?? t('unknown')}</p>
                    </div>
                    <strong className={css.directionScore}>{direction.score === null ? '—' : formatScore(direction.score.mean, t('unknown'))}</strong>
                    <div className={css.directionMeta}>
                      <span title={direction.score?.revision ?? direction.revision ?? direction.harnessRef}>
                        {t('overview.harnessVersion')}<strong>{shortVersion(direction.score?.revision ?? direction.revision ?? direction.harnessRef, t('unknown'))}</strong>
                      </span>
                      <span>{t('breakdown.taskCoverage')}<strong>{direction.score === null ? '—' : `${direction.score.taskCount}/${display(direction.score.plannedTaskCount, t('unknown'))}`}</strong></span>
                      <span>{t('breakdown.validRuns')}<strong>{direction.score?.runCount ?? 0}</strong></span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            {evaluation.comparison.exclusions.length > 0 && (
              <details className={css.exclusions}>
                <summary>{evaluation.comparison.strict ? t('strict') : t('exploratory')} · {evaluation.comparison.exclusions.length}</summary>
                <ul>{evaluation.comparison.exclusions.map(item => <li key={`${item.runId}:${item.code}`}>{item.code} · {item.runId}</li>)}</ul>
              </details>
            )}
            <section className={css.section}>
              <div className={css.sectionHeader}>
                <div><span className={css.kicker}>02</span><h2>{t('breakdown.tasks')}</h2></div>
                <div className={css.filters}>
                  {(['all', 'regressed', 'improved', 'unchanged'] as const).map(filter => (
                    <button type="button" className={css.filter} data-selected={taskFilter === filter} key={filter} onClick={() => { setTaskFilter(filter) }}>
                      {t(`breakdown.${filter}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={css.summaryStrip}>
                <span className={css.summaryItem}><strong>{taskIdentity.size}</strong>{t('breakdown.taskCoverage')}</span>
                <span className={css.summaryItem}><strong>{validRuns}</strong>{t('breakdown.validRuns')}</span>
                <span className={css.summaryItem}><strong>{evaluation.comparison.tasks.filter(task => task.status === 'improved').length}</strong>{t('breakdown.improved')}</span>
                <span className={css.summaryItem}><strong>{evaluation.comparison.tasks.filter(task => task.status === 'regressed').length}</strong>{t('breakdown.regressed')}</span>
              </div>
              {tasks.length === 0 ? <div className={css.empty}>{t('breakdown.noTasks')}</div> : (
                <div className={css.tableWrap}>
                  <table className={css.table}>
                    <thead>
                      <tr>
                        <th>{t('task')}</th>
                        {directions.map(direction => <th key={direction.id}>{direction.label}<span>{shortVersion(direction.score?.revision ?? direction.revision ?? direction.harnessRef, t('unknown'))}</span></th>)}
                        <th>{t('delta')}</th><th />
                      </tr>
                    </thead>
                    <tbody>{tasks.map((task) => (
                      <tr key={task.taskKey} data-status={task.comparison?.status ?? 'pending'}>
                        <td className={css.taskIdentity}>
                          <strong>{task.taskId}</strong>
                          <span className={css.pill}>{statusLabel(task.comparison?.status ?? 'pending', t)}</span>
                        </td>
                        {directions.map(direction => {
                          const runs = allRuns.filter(run => run.taskKey === task.taskKey && run.candidateId === direction.id)
                          const mean = validMean(runs)
                          return (
                            <td className={css.taskScore} key={direction.id} title={runs.map(run => attemptLabel(run, t)).join('\n')}>
                              <strong>{formatScore(mean, '—')}</strong>
                              <span className={css.taskRuns}>{runs.length} {t('attempts')}</span>
                            </td>
                          )
                        })}
                        <td className={css.taskDelta} data-sign={task.comparison?.delta === null || task.comparison === null ? 'none' : task.comparison.delta > 0 ? 'positive' : task.comparison.delta < 0 ? 'negative' : 'neutral'}>
                          {formatDelta(task.comparison?.delta ?? null, '—')}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={css.taskAction}
                            disabled={task.comparison === null}
                            onClick={() => { closeDetails(); void openTask(task.taskKey) }}
                          >{t('compare')} <span aria-hidden="true">↗</span></button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    )
  }

  const allRuns = state.evaluation?.evaluations.flatMap(item => item.runs) ?? []
  const runById = new Map(allRuns.map(run => [run.id, run]))
  const selectableRuns = allRuns.filter(run => run.taskKey === state.selectedTaskKey
    && (run.trajectory.availability === 'available' || run.trajectory.availability === 'provider-only'))
    .sort((left, right) => left.harness.id.localeCompare(right.harness.id) || left.attempt - right.attempt)
  const selectedTask = state.evaluation?.comparison.tasks.find(task => task.taskKey === state.selectedTaskKey) ?? null
  return (
    <main className={css.root}>
      <header className={css.header}>
        <button type="button" className={css.backButton} onClick={back} aria-label={t('back')}>←</button>
        <div className={css.comparisonHead}>
          <span className={css.kicker}>{t('comparison.title')}</span>
          <h2>{selectedTask?.taskId ?? state.selectedTaskKey ?? t('unknown')}</h2>
          {state.attemptPairing === 'unpaired' && <span className={css.pill} data-tone="warning">{t('unpaired')}</span>}
        </div>
      </header>
      {state.error !== null && <p className={css.error}>{state.error}</p>}
      <section className={css.runPicker}>
        <div className={css.sectionHeader}>
          <div><h3>{t('comparison.chooseRuns')}</h3><span className={css.muted}>{t('comparison.chooseHint')}</span></div>
          <span className={css.pill}>{state.selectedRunIds.length}/4</span>
        </div>
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
      </section>
      <div className={css.lanes}>
        {state.selectedRunIds.map((runId) => {
          const run = runById.get(runId)
          if (run === undefined) return null
          return (
            <TrajectoryLane
              key={runId}
              run={run}
              document={state.trajectories[runId]}
              loadRaw={(cursor) => { void loadProviderEvidence(runId, 0, cursor) }}
              closeRaw={() => { closeProviderEvidence(runId) }}
              raw={state.providerEvidence?.runId === runId ? state.providerEvidence : null}
            />
          )
        })}
      </div>
    </main>
  )
}

/** Rich `/refine` command lifecycle linked to the authoritative sidecar event. */
export function RefineCommandCard(props: CardProps) {
  const { node, openView, useSession, useRefinement, ensure, selectRefinement, t } = props
  const links = useSession(snapshot => snapshot.views.get('refinement-links') ?? EMPTY_LINKS)
  const refinementId = node.outcome?.sourceEventSeq === undefined
    ? undefined
    : links.get(node.outcome.sourceEventSeq)
  const record = useRefinement(state => refinementId === undefined
    ? undefined
    : state.records.find(candidate => candidate.id === refinementId) ?? (state.detail?.id === refinementId ? state.detail : undefined))
  useEffect(() => { void ensure() }, [ensure])
  const status = node.outcome === null
    ? t('command.running')
    : node.outcome.kind === 'error'
      ? t('command.failed')
      : record === undefined ? node.outcome.text ?? t('unknown') : statusLabel(record.status, t)
  return (
    <div className={css.command} data-refine-command="">
      <strong>/refine</strong>
      <span className={css.commandText}>{record?.objective ?? status}</span>
      {refinementId !== undefined && openView !== undefined && (
        <button type="button" onClick={() => {
          void selectRefinement(refinementId).then(() => { openView('refinement') })
        }}>{t('command.open')}</button>
      )}
    </div>
  )
}
