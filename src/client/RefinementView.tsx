import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RefinementId,
  RefinementProviderEvidencePage,
  RefinementRunView,
} from '../types.ts'
import type { RefinementController } from './controller.ts'
import { en, type RefinementKey } from './locales.ts'
import {
  DshOfflineTrajectorySurface,
  type DshTrajectoryBridge,
} from './DshOfflineTrajectorySurface.tsx'
import {
  BENCHMARK_REGRESSION_GUARDRAIL,
  benchmarkKey,
  benchmarkPortfolio,
  combinationScores,
  type BenchmarkPortfolio,
} from './benchmark-dashboard.ts'

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
  closeDetails: () => void
  dshTrajectory: DshTrajectoryBridge
}

type ViewProps = ConvViewProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'>

const ENGLISH_T = (key: RefinementKey): string => en[key]

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

function formatDuration(value: number | null, unknown: string): string {
  if (value === null || !Number.isFinite(value)) return unknown
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${Math.round(value)}ms`
}

function PortfolioDashboard({ portfolio, selectedBenchmarkKey, onSelectBenchmark, t }: {
  readonly portfolio: BenchmarkPortfolio
  readonly selectedBenchmarkKey: string | null
  readonly onSelectBenchmark: ((key: string) => void) | null
  readonly t: ViewProps['t']
}) {
  if (portfolio.benchmarks.length === 0) return <div className={css.empty}>{t('portfolio.noData')}</div>
  const points = portfolio.rows.filter(row => row.meanScore !== null && row.meanDurationMs !== null)
  const scores = points.flatMap(row => row.meanScore === null ? [] : [row.meanScore])
  const durations = points.flatMap(row => row.meanDurationMs === null ? [] : [row.meanDurationMs])
  const minScore = scores.length === 0 ? 0 : Math.min(...scores)
  const maxScore = scores.length === 0 ? 0 : Math.max(...scores)
  const minDuration = durations.length === 0 ? 0 : Math.min(...durations)
  const maxDuration = durations.length === 0 ? 0 : Math.max(...durations)
  const scoreRange = maxScore - minScore || 1
  const durationRange = maxDuration - minDuration || 1
  const guardrailPassed = portfolio.guardrailChecks - portfolio.guardrailViolations
  return (
    <div className={css.portfolio}>
      <div className={css.portfolioStats}>
        <span className={css.portfolioStat}>
          <span>{t('portfolio.benchmarks')}</span><strong>{portfolio.benchmarks.length}</strong>
        </span>
        <span className={css.portfolioStat} data-tone={portfolio.guardrailViolations > 0 ? 'warning' : 'positive'}>
          <span>{t('portfolio.guardrails')}</span>
          <strong>{portfolio.guardrailChecks === 0 ? '—' : `${guardrailPassed}/${portfolio.guardrailChecks}`}</strong>
          <small>{t('portfolio.guardrailHint')} −{BENCHMARK_REGRESSION_GUARDRAIL.toFixed(2)}</small>
        </span>
        <span className={css.portfolioStat}>
          <span>{t('portfolio.leadingDelta')}</span>
          <strong>{formatDelta(portfolio.leadingRow?.meanDelta ?? null, '—')}</strong>
          <small>{portfolio.leadingRow?.label ?? t('unknown')}</small>
        </span>
        <span className={css.portfolioStat}>
          <span>{t('breakdown.validRuns')}</span><strong>{portfolio.validRuns}</strong>
        </span>
      </div>
      <div className={css.portfolioLayout}>
        <div className={css.tableWrap}>
          <table className={`${css.table} ${css.matrix}`}>
            <thead>
              <tr>
                <th>{t('portfolio.candidate')}</th>
                {portfolio.benchmarks.map(benchmark => (
                  <th key={benchmark.key} data-selected={benchmark.key === selectedBenchmarkKey}>
                    {onSelectBenchmark === null ? benchmark.id : (
                      <button type="button" onClick={() => { onSelectBenchmark(benchmark.key) }}>{benchmark.id}</button>
                    )}
                    <span>{benchmark.revision}</span>
                  </th>
                ))}
                <th>{t('portfolio.meanReward')}</th>
                <th>{t('portfolio.meanDelta')}</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.rows.map(row => (
                <tr key={row.candidateId} data-role={row.role}>
                  <td className={css.taskIdentity}>
                    <strong>{row.label}</strong>
                    <span className={css.row}>
                      <span className={css.pill}>{roleLabel(row.role, t)}</span>
                      {row.pareto && <span className={css.pill} data-tone="best">{t('portfolio.pareto')}</span>}
                    </span>
                  </td>
                  {row.cells.map(cell => (
                    <td
                      className={css.matrixCell}
                      data-status={cell.status}
                      data-guardrail={cell.guardrailViolation}
                      key={cell.benchmark.key}
                    >
                      <strong className={css.matrixValue}>{formatScore(cell.score?.mean, '—')}</strong>
                      <span className={css.matrixDelta}>{row.role === 'baseline' ? t('baseline') : formatDelta(cell.delta, '—')}</span>
                    </td>
                  ))}
                  <td className={css.taskScore}><strong>{formatScore(row.meanScore, '—')}</strong><span className={css.taskRuns}>{row.benchmarkCoverage}/{portfolio.benchmarks.length}</span></td>
                  <td className={css.taskDelta} data-sign={row.meanDelta === null ? 'none' : row.meanDelta > 0 ? 'positive' : row.meanDelta < 0 ? 'negative' : 'neutral'}>
                    {formatDelta(row.meanDelta, '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {points.length > 1 && (
          <aside className={css.tradeoff}>
            <div>
              <span className={css.kicker}>{t('portfolio.tradeoff')}</span>
              <h3>{t('portfolio.paretoTitle')}</h3>
            </div>
            <svg className={css.tradeoffPlot} viewBox="0 0 440 230" role="img" aria-label={t('portfolio.paretoTitle')}>
              <line x1="52" x2="410" y1="190" y2="190" />
              <line x1="52" x2="52" y1="20" y2="190" />
              <text x="230" y="222" textAnchor="middle">{t('portfolio.latency')} →</text>
              <text x="13" y="108" textAnchor="middle" transform="rotate(-90 13 108)">{t('portfolio.meanReward')} →</text>
              <text x="52" y="207" textAnchor="middle">{formatDuration(minDuration, '—')}</text>
              <text x="410" y="207" textAnchor="middle">{formatDuration(maxDuration, '—')}</text>
              <text x="44" y="191" textAnchor="end">{formatScore(minScore, '—')}</text>
              <text x="44" y="25" textAnchor="end">{formatScore(maxScore, '—')}</text>
              {points.map((row) => {
                const x = 52 + (((row.meanDurationMs ?? minDuration) - minDuration) / durationRange) * 358
                const y = 190 - (((row.meanScore ?? minScore) - minScore) / scoreRange) * 165
                return (
                  <g key={row.candidateId} data-pareto={row.pareto}>
                    <circle cx={x} cy={y} r={row.pareto ? 7 : 5} />
                    <text x={x + 10} y={y - 9}>{row.label}</text>
                  </g>
                )
              })}
            </svg>
            <div className={css.tradeoffLegend}><span />{t('portfolio.paretoHint')}</div>
          </aside>
        )}
      </div>
    </div>
  )
}

function TrajectoryLane({ run, document, loadRaw, closeRaw, raw, dshTrajectory }: {
  readonly run: RefinementRunView
  readonly document: ReturnType<RefinementController['getSnapshot']>['trajectories'][string] | undefined
  readonly loadRaw: (cursor: string | null) => void
  readonly closeRaw: () => void
  readonly raw: RefinementProviderEvidencePage | null
  readonly dshTrajectory: DshTrajectoryBridge
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
  useRefinement, ensure, selectRefinement, selectIteration, setComparisonDimension, openTask, selectRuns, back,
  loadProviderEvidence, closeProviderEvidence, closeDetails, dshTrajectory, t,
}: ViewProps) {
  const state = useRefinement(value => value)
  const [taskFilter, setTaskFilter] = useState<'all' | 'improved' | 'regressed' | 'unchanged'>('all')
  const [selectedBenchmarkKey, setSelectedBenchmarkKey] = useState<string | null>(null)
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
  const selectedEvaluation = state.selectedIterationId === null
    ? state.evaluation
    : state.evaluationHistory[state.selectedIterationId] ?? state.evaluation
  const currentBenchmarkRef = selectedEvaluation?.evaluations[0]?.ref ?? selectedIteration?.evaluationRefs[0] ?? null
  const overviewScores = state.selectedIterationId === null
    ? []
    : combinationScores(state.selectedIterationId, selectedEvaluation)
  const overviewPortfolio = benchmarkPortfolio(
    overviewScores,
    detail?.candidates ?? [],
    detail?.baselineCandidateId ?? null,
  )
  const bestPortfolioRow = overviewPortfolio.leadingRow
  const best = overviewScores.find(score => score.candidateId === bestPortfolioRow?.candidateId) ?? null
  const bestCandidate = detail?.candidates.find(candidate => candidate.id === best?.candidateId) ?? null

  if (state.level === 'overview') {
    if (detail === null) return <main className={css.root}><div className={css.empty}>{t('loading')}</div></main>
    const benchmarkId = overviewPortfolio.benchmarks.length > 1
      ? t('portfolio.title')
      : currentBenchmarkRef?.benchmarkId ?? t('unknown')
    const benchmarkRevision = overviewPortfolio.benchmarks.length > 1
      ? String(overviewPortfolio.benchmarks.length)
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
                    {best.provisional && <span className={css.pill} data-tone="warning">{t('overview.provisional')}</span>}
                  </div>
                </>
              )}
            </div>
            <div className={css.facts}>
              <span className={css.fact}>
                <span className={css.factLabel}>{overviewPortfolio.benchmarks.length > 1 ? t('portfolio.benchmarks') : t('overview.benchmarkVersion')}</span>
                {benchmarkRevision}
              </span>
              <span className={css.fact}>
                <span className={css.factLabel}>{overviewPortfolio.benchmarks.length > 1 ? t('portfolio.guardrails') : t('breakdown.taskCoverage')}</span>
                {overviewPortfolio.benchmarks.length > 1
                  ? overviewPortfolio.guardrailChecks === 0
                    ? t('unknown')
                    : `${overviewPortfolio.guardrailChecks - overviewPortfolio.guardrailViolations}/${overviewPortfolio.guardrailChecks}`
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
            <span className={css.scoreLabel}>{overviewPortfolio.benchmarks.length > 1 ? t('portfolio.meanReward') : t('overview.bestScore')}</span>
            <strong className={css.scoreValue}>{bestPortfolioRow === null ? '—' : formatScore(bestPortfolioRow.meanScore, t('unknown'))}</strong>
            {bestPortfolioRow !== null && (
              <span className={css.muted}>
                {formatDelta(bestPortfolioRow.meanDelta, '—')} {t('portfolio.meanDelta')} · {bestPortfolioRow.benchmarkCoverage}/{overviewPortfolio.benchmarks.length}
              </span>
            )}
          </div>
        </section>
        {detail.failure !== undefined && <p className={css.error}>{detail.failure.code}: {detail.failure.message}</p>}
        {overviewPortfolio.benchmarks.length > 0 && (
          <section className={css.section}>
            <div className={css.sectionHeader}>
              <div><span className={css.kicker}>{t('portfolio.kicker')}</span><h2>{t('portfolio.dashboard')}</h2></div>
            </div>
            <PortfolioDashboard portfolio={overviewPortfolio} selectedBenchmarkKey={null} onSelectBenchmark={null} t={t} />
          </section>
        )}
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
    const portfolio = benchmarkPortfolio(currentScores, detail?.candidates ?? [], detail?.baselineCandidateId ?? null)
    const evaluationBenchmarks = [...new Map((evaluation?.evaluations ?? []).map(item => {
      const key = benchmarkKey(item.ref)
      return [key, { key, id: item.ref.benchmarkId, revision: item.ref.benchmarkRevision }]
    })).values()]
    const activeBenchmarkKey = evaluationBenchmarks.some(benchmark => benchmark.key === selectedBenchmarkKey)
      ? selectedBenchmarkKey
      : evaluationBenchmarks[0]?.key ?? null
    const activeEvaluations = evaluation?.evaluations.filter(item => benchmarkKey(item.ref) === activeBenchmarkKey) ?? []
    const activeScores = currentScores.filter(score => benchmarkKey(score) === activeBenchmarkKey)
    const allRuns = activeEvaluations.flatMap(item => item.runs)
    const directionIds = [...new Set(activeEvaluations.map(item => item.ref.candidateId))]
    const directions = directionIds.map((candidateId) => {
      const candidate = detail?.candidates.find(item => item.id === candidateId) ?? null
      return {
        id: candidateId,
        label: candidate?.label ?? String(candidateId),
        role: candidate?.role ?? 'candidate',
        harnessRef: candidate?.requestedHarnessRef ?? t('unknown'),
        revision: candidate?.revisionIdentity ?? null,
        score: activeScores.find(item => item.candidateId === candidateId) ?? null,
        failed: activeEvaluations.some(item => item.ref.candidateId === candidateId
          && item.ref.failedEvaluation !== undefined),
        rerunning: activeEvaluations.some(item => item.ref.candidateId === candidateId
          && item.status === 'rerunning'),
        running: activeEvaluations.some(item => item.ref.candidateId === candidateId
          && (item.status === 'queued' || item.status === 'running' || item.status === 'rerunning')),
      }
    })
    const comparisonByTask = new Map(evaluation?.comparison.tasks.map(task => [task.taskKey, task]) ?? [])
    const taskIdentity = new Map<string, string>()
    for (const run of allRuns) taskIdentity.set(run.taskKey, run.taskId)
    const activeTaskComparisons = [...taskIdentity.keys()].flatMap(taskKey => {
      const comparison = comparisonByTask.get(taskKey)
      return comparison === undefined ? [] : [comparison]
    })
    const statusOrder = { regressed: 0, invalid: 1, improved: 2, unchanged: 3, pending: 4 } as const
    const tasks = [...taskIdentity.entries()].map(([taskKey, taskId]) => ({
      taskKey,
      taskId,
      comparison: comparisonByTask.get(taskKey) ?? null,
    })).filter(item => taskFilter === 'all' || item.comparison?.status === taskFilter)
      .sort((left, right) => (statusOrder[left.comparison?.status ?? 'pending'] - statusOrder[right.comparison?.status ?? 'pending'])
        || left.taskId.localeCompare(right.taskId))
    const validRuns = allRuns.filter(run => run.integrity === 'valid' && run.observation.state === 'valid').length
    const activeRunIds = new Set(allRuns.map(run => run.id))
    const comparisonExclusions = evaluation?.comparison.exclusions.filter(item => activeRunIds.has(item.runId)) ?? []
    const bestCurrent = activeScores[0] ?? null
    const benchmark = activeEvaluations[0]?.ref ?? currentBenchmarkRef
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
        {selectedIteration?.failure !== undefined && (
          <p className={css.error}>{selectedIteration.failure.code}: {selectedIteration.failure.message}</p>
        )}
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
                <div><span className={css.kicker}>01 · {t('portfolio.kicker')}</span><h2>{t('portfolio.dashboard')}</h2></div>
              </div>
              <PortfolioDashboard
                portfolio={portfolio}
                selectedBenchmarkKey={activeBenchmarkKey}
                onSelectBenchmark={(key) => { setSelectedBenchmarkKey(key); setTaskFilter('all'); closeDetails() }}
                t={t}
              />
            </section>
            <nav className={css.benchmarkTabs} aria-label={t('portfolio.selectedBenchmark')}>
              {evaluationBenchmarks.map(item => (
                <button
                  type="button"
                  data-selected={item.key === activeBenchmarkKey}
                  key={item.key}
                  onClick={() => { setSelectedBenchmarkKey(item.key); setTaskFilter('all'); closeDetails() }}
                >
                  <strong>{item.id}</strong><span>{item.revision}</span>
                </button>
              ))}
            </nav>
            <section className={css.section}>
              <div className={css.sectionHeader}>
                <div><span className={css.kicker}>02 · {benchmark?.benchmarkId ?? t('unknown')}</span><h2>{t('breakdown.experiments')}</h2></div>
              </div>
              <div className={css.directions}>
                {directions.map(direction => (
                  <article className={css.direction} data-role={direction.role} key={direction.id}>
                    <div className={css.directionTop}>
                      <span className={css.pill}>{roleLabel(direction.role, t)}</span>
                      {direction.running && <span className={css.pill}>{t(direction.rerunning ? 'status.rerunning' : 'status.evaluating')}</span>}
                      {direction.score?.provisional === true && <span className={css.pill} data-tone="warning">{t('overview.provisional')}</span>}
                      {direction.failed && <span className={css.pill} data-tone="warning">{t('evaluation.failedEvidence')}</span>}
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
                      <span>{t('breakdown.taskCoverage')}<strong>{direction.score === null ? '—' : `${direction.score.taskCount}/${display(direction.score.plannedTaskCount, '?')}`}</strong></span>
                      <span>{t('breakdown.validRuns')}<strong>{direction.score?.runCount ?? 0}</strong></span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
            {comparisonExclusions.length > 0 && (
              <details className={css.exclusions}>
                <summary>{evaluation.comparison.strict ? t('strict') : t('exploratory')} · {comparisonExclusions.length}</summary>
                <ul>{comparisonExclusions.map(item => <li key={`${item.runId}:${item.code}`}>{item.code} · {item.runId}</li>)}</ul>
              </details>
            )}
            <section className={css.section}>
              <div className={css.sectionHeader}>
                <div><span className={css.kicker}>03</span><h2>{t('breakdown.tasks')}</h2></div>
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
                <span className={css.summaryItem}><strong>{activeTaskComparisons.filter(task => task.status === 'improved').length}</strong>{t('breakdown.improved')}</span>
                <span className={css.summaryItem}><strong>{activeTaskComparisons.filter(task => task.status === 'regressed').length}</strong>{t('breakdown.regressed')}</span>
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
      {selectedIteration?.failure !== undefined && (
        <p className={css.error}>{selectedIteration.failure.code}: {selectedIteration.failure.message}</p>
      )}
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
              dshTrajectory={dshTrajectory}
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
