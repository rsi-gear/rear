import { useEffect, useMemo, useState, type JSX } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CommandRowProps,
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  RefinementId,
  RefinementProviderEvidencePage,
  RefinementRunView,
} from '../types.ts'
import type { RefinementController } from './controller.ts'
import type { RefinementLinksSnapshot } from './refinement-links.ts'

type TrajectorySurfaceProps = {
  readonly snapshot: unknown
  readonly history: 'complete' | 'paged'
  readonly actualDuration: boolean
  readonly onActualDurationChange: (value: boolean) => void
  readonly t: (key: string, params?: Record<string, unknown>) => string
}

// DSH client bundles may only share runtime values through platform seeds or
// Cordis services. ui-trajectory is currently a pure consumer plugin, so its
// non-public component values cannot be required from an external bundle.
// Keep the capability empty until DSH promotes the offline surface to a
// supported shared service; provider evidence remains available meanwhile.
const trajectoryExports: {
  readonly buildOfflineTrajectorySnapshot?: (header: unknown, events: readonly unknown[]) => unknown
  readonly TrajectorySurface?: (props: TrajectorySurfaceProps) => JSX.Element
} = {}

const css = {
  root: 'rear-refinement-root', header: 'rear-refinement-header', list: 'rear-refinement-list',
  card: 'rear-refinement-card', row: 'rear-refinement-row', muted: 'rear-refinement-muted',
  error: 'rear-refinement-error', meta: 'rear-refinement-meta', table: 'rear-refinement-table',
  attempt: 'rear-refinement-attempt', lanes: 'rear-refinement-lanes', lane: 'rear-refinement-lane',
  laneHeader: 'rear-refinement-lane-header', laneBody: 'rear-refinement-lane-body',
  raw: 'rear-refinement-raw', command: 'rear-refinement-command', commandText: 'rear-refinement-command-text',
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
  closeDetails: () => void
  trajectoryT: TrajectorySurfaceProps['t']
}

type ViewProps = ConvViewProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'>
type CardProps = CommandRowProps & InjectFace<RefinementInjected> & PropsLocale<'refinement'> & {
  readonly openView?: (viewId: string) => void
}

function display(value: string | number | null | undefined, unknown: string): string {
  return value === null || value === undefined || value === '' ? unknown : String(value)
}

function attemptLabel(run: RefinementRunView, unknown: string): string {
  const observation = run.observation.state === 'valid'
    ? String(run.observation.reward)
    : run.observation.state === 'invalid'
      ? `invalid: ${run.observation.reason}`
      : unknown
  return `#${run.attempt} · ${run.execution} · ${observation}`
}

function TrajectoryLane({ run, document, trajectoryT, loadRaw, raw, t }: {
  readonly run: RefinementRunView
  readonly document: ReturnType<RefinementController['getSnapshot']>['trajectories'][string] | undefined
  readonly trajectoryT: TrajectorySurfaceProps['t']
  readonly loadRaw: (cursor: string | null) => void
  readonly raw: RefinementProviderEvidencePage | null
  readonly t: ViewProps['t']
}) {
  const [actualDuration, setActualDuration] = useState(false)
  const TrajectorySurface = trajectoryExports.TrajectorySurface
  const snapshot = useMemo(() => document === null || document === undefined
    || trajectoryExports.buildOfflineTrajectorySnapshot === undefined
    ? null
    : trajectoryExports.buildOfflineTrajectorySnapshot(document.header, document.events), [document])
  const observation = run.observation.state === 'valid'
    ? `reward ${run.observation.reward}`
    : run.observation.state === 'invalid'
      ? `invalid: ${run.observation.reason}`
      : t('unknown')
  const duration = run.startedAt === undefined || run.completedAt === undefined
    ? null
    : run.completedAt - run.startedAt
  return (
    <section className={css.lane} data-run-id={run.id}>
      <div className={css.laneHeader}>
        <span>{run.harness.id} · {run.model.effectiveId ?? run.model.requestedId} · #{run.attempt}</span>
        <span>{run.execution} · {observation} · {duration === null ? t('unknown') : `${duration} ms`}</span>
        <span>eval {run.evalId} · trial {run.trialId} · protocol {run.protocolIdentity}</span>
        {run.trajectory.summary !== undefined && (
          <span>
            tools {display(run.trajectory.summary.toolCalls, t('unknown'))}
            {' · '}tokens {display(run.trajectory.summary.inputTokens, t('unknown'))}/{display(run.trajectory.summary.outputTokens, t('unknown'))}
            {' · '}TTFT {display(run.trajectory.summary.ttftMs, t('unknown'))}
          </span>
        )}
        {run.trajectory.providerFileCount > 0 && <button type="button" onClick={() => { loadRaw(null) }}>{t('evidence.raw')}</button>}
      </div>
      <div className={css.laneBody}>
        {raw !== null && (
          <div>
            <pre className={css.raw}>{raw.content}</pre>
            {raw.nextCursor !== null && (
              <button type="button" onClick={() => { loadRaw(raw.nextCursor) }}>{t('evidence.next')}</button>
            )}
          </div>
        )}
        {snapshot === null || TrajectorySurface === undefined
          ? <div className={css.card}>{run.trajectory.availability} · DSH TrajectorySurface requires a newer compatible host.</div>
          : <TrajectorySurface
              snapshot={snapshot}
              history="complete"
              actualDuration={actualDuration}
              onActualDurationChange={setActualDuration}
              t={trajectoryT}
            />}
      </div>
    </section>
  )
}

/** Always-present Refine conversation view with overview, evaluation, and comparison levels. */
export function RefinementView({
  useRefinement, ensure, selectRefinement, selectIteration, setComparisonDimension, openTask, selectRuns, back, cancel,
  loadProviderEvidence, closeDetails, trajectoryT, t,
}: ViewProps) {
  const state = useRefinement(value => value)
  useEffect(() => { void ensure() }, [ensure])

  if (state.status === 'cold' || state.status === 'loading') {
    return <main className={css.root}>{t('loading')}</main>
  }
  if (state.records.length === 0 && state.detail === null) {
    return <main className={css.root}><h2>{t('empty.title')}</h2><p className={css.muted}>{t('empty.body')}</p>{state.error !== null && <p className={css.error}>{state.error}</p>}</main>
  }
  if (state.level === 'overview') {
    return (
      <main className={css.root}>
        <header className={css.header}><h2>{t('overview.title')}</h2></header>
        {state.error !== null && <p className={css.error}>{state.error}</p>}
        <div className={css.list}>
          {state.records.map(record => (
            <article className={css.card} key={record.id}>
              <div className={css.row}>
                <strong>{display(record.objective, t('unknown'))}</strong>
                <button type="button" onClick={() => { void selectRefinement(record.id) }}>{t('open')}</button>
              </div>
              <span className={css.muted}>{record.status} · {record.iterationCount} {t('iterations')}</span>
              {state.detail?.id === record.id && (
                <>
                  <dl className={css.meta}>
                    <dt>{t('status')}</dt><dd>{state.detail.status}</dd>
                    <dt>{t('objective')}</dt><dd>{display(state.detail.objective, t('unknown'))}</dd>
                    <dt>baseline</dt><dd>{display(state.detail.baselineCandidateId, t('unknown'))}</dd>
                  </dl>
                  {state.detail.failure !== undefined && (
                    <p className={css.error}>{state.detail.failure.code}: {state.detail.failure.message}</p>
                  )}
                  {state.detail.candidates.length > 0 && (
                    <ul>{state.detail.candidates.map(candidate => (
                      <li key={candidate.id}>
                        {candidate.role} · {candidate.label} · {candidate.requestedHarnessRef}
                        {' · '}{display(candidate.revisionIdentity, t('unknown'))}
                        {' · parent '}{display(candidate.parentCandidateId, t('unknown'))}
                      </li>
                    ))}</ul>
                  )}
                  <div className={css.list}>
                    {state.detail.iterations.map(iteration => (
                      <div key={iteration.id} className={css.card}>
                        <button type="button" onClick={() => { void selectIteration(iteration.id) }}>
                          #{iteration.ordinal} · {iteration.status} · {iteration.evaluationRefs.length} eval
                        </button>
                        {iteration.evaluationRefs.map(ref => (
                          <span key={ref.evalId} className={css.muted}>
                            {ref.evalId} · {ref.benchmarkId}@{ref.benchmarkRevision} · {ref.requestedModelId}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                  {state.evaluation !== null && (
                    <div className={css.card}>
                      {state.evaluation.evaluations.map(item => (
                        <span key={item.ref.evalId}>
                          {item.ref.evalId}: {item.settledTasks}/{display(item.plannedTasks, t('unknown'))}
                          {' · '}valid {item.runs.filter(run => run.observation.state === 'valid' && run.integrity === 'valid').length}
                          {' · '}invalid {item.runs.filter(run => run.observation.state === 'invalid').length}
                          {' · '}failed {item.runs.filter(run => run.execution === 'failed' || run.execution === 'timed-out').length}
                          {' · '}corrupt {item.runs.filter(run => run.integrity === 'corrupt').length}
                        </span>
                      ))}
                    </div>
                  )}
                  {!['completed', 'failed', 'cancelled'].includes(state.detail.status)
                    && <button type="button" onClick={() => { void cancel() }}>{t('cancel')}</button>}
                </>
              )}
            </article>
          ))}
        </div>
      </main>
    )
  }

  if (state.level === 'evaluation') {
    const evaluation = state.evaluation
    return (
      <main className={css.root}>
        <header className={css.header}>
          <button type="button" onClick={back}>{t('back')}</button>
          <h2>{t('evaluation.title')}</h2>
          <span>{evaluation?.comparison.strict === true ? t('strict') : t('exploratory')}</span>
          <button type="button" disabled={state.comparisonDimension === 'harness'} onClick={() => { void setComparisonDimension('harness') }}>{t('dimension.harness')}</button>
          <button type="button" disabled={state.comparisonDimension === 'model'} onClick={() => { void setComparisonDimension('model') }}>{t('dimension.model')}</button>
        </header>
        {state.error !== null && <p className={css.error}>{state.error}</p>}
        {evaluation === null ? <p>{t('loading')}</p> : (
          <>
            {evaluation.comparison.exclusions.length > 0 && (
              <ul>{evaluation.comparison.exclusions.map(item => <li key={`${item.runId}:${item.code}`}>{item.code} · {item.runId}</li>)}</ul>
            )}
            <table className={css.table}>
              <thead><tr><th>{t('task')}</th><th>{t('baseline')}</th><th>{t('candidate')}</th><th>{t('delta')}</th><th>{t('state')}</th><th /></tr></thead>
              <tbody>{evaluation.comparison.tasks.map((task) => {
                const runs = evaluation.evaluations.flatMap(item => item.runs)
                const byId = new Map(runs.map(run => [run.id, run]))
                return (
                  <tr key={task.taskKey}>
                    <td>{task.taskId}</td>
                    <td>{display(task.referenceMean, t('unknown'))}{task.referenceRunIds.flatMap((id) => {
                      const run = byId.get(id)
                      return run === undefined ? [] : [<span className={css.attempt} key={id}>{attemptLabel(run, t('unknown'))}</span>]
                    })}</td>
                    <td>{display(task.candidateMean, t('unknown'))}{task.candidateRunIds.flatMap((id) => {
                      const run = byId.get(id)
                      return run === undefined ? [] : [<span className={css.attempt} key={id}>{attemptLabel(run, t('unknown'))}</span>]
                    })}</td>
                    <td>{display(task.delta, t('unknown'))}</td><td>{task.status}</td>
                    <td><button type="button" onClick={() => { closeDetails(); void openTask(task.taskKey) }}>{t('compare')}</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </>
        )}
      </main>
    )
  }

  const allRuns = state.evaluation?.evaluations.flatMap(item => item.runs) ?? []
  const runById = new Map(allRuns.map(run => [run.id, run]))
  const selectableRuns = allRuns.filter(run => run.taskKey === state.selectedTaskKey
    && (run.trajectory.availability === 'available' || run.trajectory.availability === 'provider-only'))
  return (
    <main className={css.root}>
      <header className={css.header}>
        <button type="button" onClick={back}>{t('back')}</button>
        <h3>{t('comparison.title')}</h3>
        <span>{state.attemptPairing === 'unpaired' ? t('unpaired') : ''}</span>
      </header>
      <fieldset>
        <legend>{t('runs')}</legend>
        {selectableRuns.map(run => (
          <label key={run.id}>
            <input
              type="checkbox"
              checked={state.selectedRunIds.includes(run.id)}
              onChange={() => {
                const next = state.selectedRunIds.includes(run.id)
                  ? state.selectedRunIds.filter(id => id !== run.id)
                  : [...state.selectedRunIds, run.id]
                if (next.length >= 1 && next.length <= 4) void selectRuns(next)
              }}
            />
            {run.harness.id} · #{run.attempt}
          </label>
        ))}
      </fieldset>
      <div className={css.lanes}>
        {state.selectedRunIds.map((runId) => {
          const run = runById.get(runId)
          if (run === undefined) return null
          return (
            <TrajectoryLane
              key={runId}
              run={run}
              document={state.trajectories[runId]}
              trajectoryT={trajectoryT}
              loadRaw={(cursor) => { void loadProviderEvidence(runId, 0, cursor) }}
              raw={state.providerEvidence?.runId === runId ? state.providerEvidence : null}
              t={t}
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
      : record?.status ?? node.outcome.text ?? t('unknown')
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
