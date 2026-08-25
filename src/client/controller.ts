import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  CanonicalTrajectoryDocument,
  HitchRunId,
  RefinementComparisonDimension,
  RefinementEvaluationRequest,
  RefinementEvaluationResult,
  RefinementEvaluationView,
  RefinementGetRequest,
  RefinementGetResult,
  RefinementId,
  RefinementIterationId,
  RefinementListRequest,
  RefinementListResult,
  RefinementProviderEvidencePage,
  RefinementProviderEvidenceRequest,
  RefinementProviderEvidenceResult,
  RefinementRecordV1,
  RefinementSummary,
  RefinementTrajectoryRequest,
  RefinementTrajectoryResult,
} from '../types.ts'

/** Transport-neutral generated Remote surface consumed by one controller. */
export interface RefinementRemoteClient {
  list(request: RefinementListRequest, signal?: AbortSignal): Promise<RefinementListResult>
  get(request: RefinementGetRequest, signal?: AbortSignal): Promise<RefinementGetResult>
  evaluation(request: RefinementEvaluationRequest, signal?: AbortSignal): Promise<RefinementEvaluationResult>
  trajectory(request: RefinementTrajectoryRequest, signal?: AbortSignal): Promise<RefinementTrajectoryResult>
  providerEvidence(request: RefinementProviderEvidenceRequest, signal?: AbortSignal): Promise<RefinementProviderEvidenceResult>
  changes(
    request: { readonly sessionId: SessionId; readonly after: string | null },
    signal?: AbortSignal,
  ): Promise<{ readonly token: string | null; readonly refinementId: RefinementId | null }>
}

/** Complete immutable snapshot rendered by the Refine conversation view. */
export interface RefinementViewState {
  readonly status: 'cold' | 'loading' | 'ready' | 'error'
  readonly level: 'overview' | 'evaluation' | 'comparison'
  readonly selectedRefinementId: RefinementId | null
  readonly selectedIterationId: RefinementIterationId | null
  readonly comparisonDimension: RefinementComparisonDimension
  readonly referenceRunId: HitchRunId | null
  readonly selectedTaskKey: string | null
  readonly selectedRunIds: readonly HitchRunId[]
  readonly attemptPairing: 'paired' | 'unpaired' | null
  readonly records: readonly RefinementSummary[]
  readonly detail: RefinementRecordV1 | null
  readonly evaluation: RefinementEvaluationView | null
  /** Evaluation projections retained by iteration so the overview can rank every tested version. */
  readonly evaluationHistory: Readonly<Record<string, RefinementEvaluationView>>
  readonly trajectories: Readonly<Record<string, CanonicalTrajectoryDocument | null>>
  readonly providerEvidence: RefinementProviderEvidencePage | null
  readonly error: string | null
}

const INITIAL_STATE: RefinementViewState = {
  status: 'cold',
  level: 'overview',
  selectedRefinementId: null,
  selectedIterationId: null,
  comparisonDimension: 'harness',
  referenceRunId: null,
  selectedTaskKey: null,
  selectedRunIds: [],
  attemptPairing: null,
  records: [],
  detail: null,
  evaluation: null,
  evaluationHistory: {},
  trajectories: {},
  providerEvidence: null,
  error: null,
}

/** Small framework-neutral observable; Cordis slot hooks only require this public shape. */
interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(value: T): void
}

function createStore<T>(initial: T): SnapshotStore<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (Object.is(value, next)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function evidenceAvailable(availability: string): boolean {
  return availability === 'available' || availability === 'provider-only'
}

/** Per-Session object layer for reads, invalidation, and lane selection. */
export class RefinementController {
  /** Observable state rendered by the Refine view. */
  readonly store: SnapshotStore<RefinementViewState> = createStore(INITIAL_STATE)
  private readonly requests = new Map<string, { controller: AbortController; generation: number }>()
  private nextGeneration = 0
  private invalidationQueued = false
  private disposed = false
  private changesController: AbortController | undefined
  private changeToken: string | null = null

  /** @param remote - generated refinement Remote adapter. @param sessionId - exact Session id. */
  constructor(
    private readonly remote: RefinementRemoteClient,
    readonly sessionId: SessionId,
  ) {}

  /**
   * Observable snapshot compatibility for direct hook injection.
   * @returns Current immutable controller state.
   */
  getSnapshot(): RefinementViewState { return this.store.getSnapshot() }

  /**
   * Observable snapshot compatibility for direct hook injection.
   * @param listener - callback invoked after state changes.
   * @returns Subscription disposer.
   */
  subscribe(listener: () => void): () => void { return this.store.subscribe(listener) }

  /** Load this Session once; repeated calls preserve valid selection and re-synchronize. */
  async ensure(): Promise<void> {
    this.startWatching()
    if (this.store.getSnapshot().status === 'cold') await this.resync()
  }

  /** Restart the event-driven change wait after a transport generation reset. */
  reconnect(): void {
    this.changesController?.abort('refinement connection reset')
    this.changesController = undefined
    this.startWatching()
    if (this.store.getSnapshot().status !== 'cold') void this.resync()
  }

  /** Authoritatively re-read list, detail, and evaluation after reconnect. */
  async resync(): Promise<void> {
    const current = this.store.getSnapshot()
    this.store.set({ ...current, status: 'loading', error: null })
    const request = this.begin('list')
    try {
      const result = await this.remote.list({ sessionId: this.sessionId }, request.signal)
      if (!this.current('list', request.generation)) return
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      const records = result.value.records
      const previous = this.store.getSnapshot().selectedRefinementId
      const selected = previous !== null && records.some(record => record.id === previous)
        ? previous
        : records[0]?.id ?? null
      this.store.set({
        ...this.store.getSnapshot(),
        status: 'ready',
        records,
        selectedRefinementId: selected,
        ...(selected === null ? {
          detail: null,
          evaluation: null,
          evaluationHistory: {},
          selectedIterationId: null,
          selectedTaskKey: null,
          selectedRunIds: [],
          trajectories: {},
        } : {}),
        error: null,
      })
      if (selected !== null) await this.refreshDetail(selected)
    } catch (error) {
      if (request.signal.aborted || this.disposed) return
      this.store.set({ ...this.store.getSnapshot(), status: 'error', error: failure(error) })
    }
  }

  /**
   * Select and load one refinement, retaining the selection across view switches.
   * @param refinementId - Gear evolution projection to select.
   */
  async selectRefinement(refinementId: RefinementId): Promise<void> {
    const current = this.store.getSnapshot()
    if (current.selectedRefinementId !== refinementId) {
      this.abort('detail')
      this.abort('evaluation')
      this.abortPrefix('evaluation-history:')
      this.store.set({
        ...current,
        selectedRefinementId: refinementId,
        level: 'overview',
        selectedIterationId: null,
        selectedTaskKey: null,
        selectedRunIds: [],
        attemptPairing: null,
        detail: null,
        evaluation: null,
        evaluationHistory: {},
        trajectories: {},
        providerEvidence: null,
        error: null,
      })
    }
    await this.refreshDetail(refinementId)
  }

  /**
   * Select an iteration and request its Host-owned comparison.
   * @param iterationId - iteration to select.
   */
  async selectIteration(iterationId: RefinementIterationId): Promise<void> {
    const state = this.store.getSnapshot()
    this.store.set({
      ...state,
      selectedIterationId: iterationId,
      level: 'evaluation',
      evaluation: null,
      selectedTaskKey: null,
      selectedRunIds: [],
      trajectories: {},
      providerEvidence: null,
    })
    await this.refreshEvaluation()
  }

  /**
   * Switch the Host comparison dimension and re-read comparison eligibility.
   * @param dimension - strict comparison identity dimension.
   */
  async setComparisonDimension(dimension: RefinementComparisonDimension): Promise<void> {
    this.store.set({ ...this.store.getSnapshot(), comparisonDimension: dimension })
    await this.refreshEvaluation()
  }

  /**
   * Open one task and deterministically preselect paired evidence attempts.
   * @param taskKey - exact provider-owned task identity.
   */
  async openTask(taskKey: string): Promise<void> {
    const evaluation = this.store.getSnapshot().evaluation
    const task = evaluation?.comparison.tasks.find(candidate => candidate.taskKey === taskKey)
    if (evaluation === null || task === undefined) return
    const runs = evaluation.evaluations.flatMap(item => item.runs)
    const byId = new Map(runs.map(run => [run.id, run]))
    const reference = task.referenceRunIds.flatMap((id) => {
      const run = byId.get(id)
      return run !== undefined && evidenceAvailable(run.trajectory.availability) ? [run] : []
    }).sort((left, right) => left.attempt - right.attempt)
    const candidate = task.candidateRunIds.flatMap((id) => {
      const run = byId.get(id)
      return run !== undefined && evidenceAvailable(run.trajectory.availability) ? [run] : []
    }).sort((left, right) => left.attempt - right.attempt)
    const shared = reference.find(run => candidate.some(other => other.attempt === run.attempt))
    const paired = shared === undefined
      ? null
      : candidate.find(run => run.attempt === shared.attempt) ?? null
    const selected = shared !== undefined && paired !== null
      ? [shared.id, paired.id]
      : [reference[0]?.id, candidate[0]?.id].filter((id): id is HitchRunId => id !== undefined)
    this.store.set({
      ...this.store.getSnapshot(),
      selectedTaskKey: taskKey,
      level: 'comparison',
      selectedRunIds: selected,
      attemptPairing: shared !== undefined && paired !== null ? 'paired' : 'unpaired',
      trajectories: {},
      providerEvidence: null,
    })
    await Promise.all(selected.map(runId => this.loadTrajectory(runId)))
  }

  /**
   * Replace lane selection after enforcing the one-to-four, same-task contract.
   * @param runIds - selected evidence runs.
   */
  async selectRuns(runIds: readonly HitchRunId[]): Promise<void> {
    if (runIds.length < 1 || runIds.length > 4) throw new RangeError('select one to four runs')
    const evaluation = this.store.getSnapshot().evaluation
    if (evaluation === null) throw new Error('no evaluation is loaded')
    const runs = new Map(evaluation.evaluations.flatMap(item => item.runs).map(run => [run.id, run]))
    const selected = runIds.map((id) => {
      const run = runs.get(id)
      if (run === undefined) throw new Error(`run ${id} is not part of the loaded evaluation`)
      if (!evidenceAvailable(run.trajectory.availability)) throw new Error(`run ${id} has no trajectory evidence`)
      return run
    })
    if (new Set(selected.map(run => run.taskKey)).size !== 1) throw new Error('selected runs have different task identities')
    this.store.set({
      ...this.store.getSnapshot(),
      selectedTaskKey: selected[0]?.taskKey ?? null,
      level: 'comparison',
      selectedRunIds: [...runIds],
      attemptPairing: null,
      trajectories: {},
      providerEvidence: null,
    })
    await Promise.all(runIds.map(runId => this.loadTrajectory(runId)))
  }

  /**
   * Load one bounded provider-native evidence page as an explicit secondary view.
   * @param runId - owning run.
   * @param fileOrdinal - provider file index.
   * @param cursor - opaque page cursor.
   */
  async loadProviderEvidence(runId: HitchRunId, fileOrdinal: number, cursor: string | null): Promise<void> {
    const detail = this.store.getSnapshot().detail
    if (detail === null) return
    this.store.set({ ...this.store.getSnapshot(), providerEvidence: null })
    const request = this.begin('provider-evidence')
    try {
      const result = await this.remote.providerEvidence({
        sessionId: this.sessionId,
        refinementId: detail.id,
        runId,
        fileOrdinal,
        cursor,
      }, request.signal)
      if (!this.current('provider-evidence', request.generation)) return
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      this.store.set({ ...this.store.getSnapshot(), providerEvidence: result.value, error: null })
    } catch (error) {
      if (!request.signal.aborted) this.store.set({ ...this.store.getSnapshot(), error: failure(error) })
    }
  }

  /** Close the visible provider-native evidence page and cancel an in-flight replacement. */
  closeProviderEvidence(runId?: HitchRunId): void {
    const state = this.store.getSnapshot()
    if (runId !== undefined && state.providerEvidence?.runId !== runId) return
    this.abort('provider-evidence')
    if (state.providerEvidence !== null) this.store.set({ ...state, providerEvidence: null })
  }

  /** Move one level upward without changing the current DSH Session. */
  back(): void {
    const state = this.store.getSnapshot()
    if (state.level === 'comparison') {
      this.store.set({ ...state, level: 'evaluation', selectedTaskKey: null, selectedRunIds: [], trajectories: {}, providerEvidence: null })
    } else if (state.level === 'evaluation') {
      this.store.set({ ...state, level: 'overview' })
    }
  }

  /**
   * Coalesce a matching Host invalidation into one authoritative refresh microtask.
   * @param refinementId - invalidated Gear evolution projection.
   */
  invalidate(refinementId: RefinementId): void {
    if (this.invalidationQueued || this.disposed) return
    this.invalidationQueued = true
    queueMicrotask(() => {
      this.invalidationQueued = false
      if (!this.disposed) void this.resync()
    })
  }

  /** Abort all requests and reject future publications. */
  dispose(): void {
    this.disposed = true
    this.changesController?.abort('refinement controller disposed')
    this.changesController = undefined
    for (const request of this.requests.values()) request.controller.abort('refinement controller disposed')
    this.requests.clear()
  }

  /** Keep one long-held change request in flight; payload-free invalidations trigger authoritative reads. */
  private startWatching(): void {
    if (this.disposed || this.changesController !== undefined) return
    const controller = new AbortController()
    this.changesController = controller
    void (async () => {
      try {
        while (!controller.signal.aborted && !this.disposed) {
          const change = await this.remote.changes({
            sessionId: this.sessionId,
            after: this.changeToken,
          }, controller.signal)
          this.changeToken = change.token
          if (change.refinementId !== null) this.invalidate(change.refinementId)
        }
      } catch (error) {
        if (!controller.signal.aborted && !this.disposed) {
          this.store.set({ ...this.store.getSnapshot(), error: failure(error) })
        }
      } finally {
        if (this.changesController === controller) this.changesController = undefined
      }
    })()
  }

  private async refreshDetail(refinementId: RefinementId): Promise<void> {
    const request = this.begin('detail')
    try {
      const result = await this.remote.get({ sessionId: this.sessionId, refinementId }, request.signal)
      if (!this.current('detail', request.generation)) return
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      const state = this.store.getSnapshot()
      if (state.selectedRefinementId !== refinementId) return
      const iterationId = state.selectedIterationId !== null
        && result.value.iterations.some(iteration => iteration.id === state.selectedIterationId)
        ? state.selectedIterationId
        : result.value.activeIterationId ?? result.value.iterations.at(-1)?.id ?? null
      this.abortPrefix('evaluation-history:')
      this.store.set({
        ...state,
        status: 'ready',
        detail: result.value,
        selectedIterationId: iterationId,
        evaluationHistory: {},
        error: null,
      })
      if (iterationId !== null) {
        await this.refreshEvaluation()
        void this.refreshEvaluationHistory(iterationId)
      }
    } catch (error) {
      if (!request.signal.aborted) this.store.set({ ...this.store.getSnapshot(), status: 'error', error: failure(error) })
    }
  }

  private async refreshEvaluation(): Promise<void> {
    const state = this.store.getSnapshot()
    const detail = state.detail
    const iterationId = state.selectedIterationId
    if (detail === null || iterationId === null) return
    const request = this.begin('evaluation')
    try {
      const result = await this.remote.evaluation({
        sessionId: this.sessionId,
        refinementId: detail.id,
        iterationId,
        dimension: state.comparisonDimension,
        referenceRunId: state.referenceRunId,
      }, request.signal)
      if (!this.current('evaluation', request.generation)) return
      const latest = this.store.getSnapshot()
      if (latest.detail?.id !== detail.id || latest.selectedIterationId !== iterationId) return
      if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      this.store.set({
        ...latest,
        evaluation: result.value,
        evaluationHistory: { ...latest.evaluationHistory, [iterationId]: result.value },
        error: null,
      })
    } catch (error) {
      if (!request.signal.aborted) this.store.set({ ...this.store.getSnapshot(), error: failure(error) })
    }
  }

  /** Load non-selected iterations in the background for the all-version overview leaderboard. */
  private async refreshEvaluationHistory(selectedIterationId: RefinementIterationId): Promise<void> {
    const state = this.store.getSnapshot()
    const detail = state.detail
    if (detail === null) return
    const iterations = detail.iterations.filter(iteration => iteration.id !== selectedIterationId && iteration.evaluationRefs.length > 0)
    await Promise.all(iterations.map(async (iteration) => {
      const key = `evaluation-history:${iteration.id}`
      const request = this.begin(key)
      try {
        const result = await this.remote.evaluation({
          sessionId: this.sessionId,
          refinementId: detail.id,
          iterationId: iteration.id,
          dimension: state.comparisonDimension,
          referenceRunId: null,
        }, request.signal)
        if (!this.current(key, request.generation) || !result.ok) return
        const latest = this.store.getSnapshot()
        if (latest.detail?.id !== detail.id) return
        this.store.set({
          ...latest,
          evaluationHistory: { ...latest.evaluationHistory, [iteration.id]: result.value },
        })
      } catch {
        // Historical evidence is additive; one unavailable iteration must not fail the active view.
      }
    }))
  }

  private async loadTrajectory(runId: HitchRunId): Promise<void> {
    const detail = this.store.getSnapshot().detail
    if (detail === null) return
    const key = `trajectory:${runId}`
    const request = this.begin(key)
    try {
      const result = await this.remote.trajectory({
        sessionId: this.sessionId,
        refinementId: detail.id,
        runId,
      }, request.signal)
      if (!this.current(key, request.generation)) return
      if (!result.ok) {
        this.store.set({
          ...this.store.getSnapshot(),
          trajectories: { ...this.store.getSnapshot().trajectories, [runId]: null },
        })
        return
      }
      this.store.set({
        ...this.store.getSnapshot(),
        trajectories: { ...this.store.getSnapshot().trajectories, [runId]: result.value },
      })
    } catch (error) {
      if (!request.signal.aborted) this.store.set({ ...this.store.getSnapshot(), error: failure(error) })
    }
  }

  private begin(key: string): { signal: AbortSignal; generation: number } {
    this.abort(key)
    const controller = new AbortController()
    const generation = ++this.nextGeneration
    this.requests.set(key, { controller, generation })
    return { signal: controller.signal, generation }
  }

  private abort(key: string): void {
    this.requests.get(key)?.controller.abort(`superseded ${key} request`)
    this.requests.delete(key)
  }

  private abortPrefix(prefix: string): void {
    for (const key of [...this.requests.keys()]) {
      if (key.startsWith(prefix)) this.abort(key)
    }
  }

  private current(key: string, generation: number): boolean {
    return !this.disposed && this.requests.get(key)?.generation === generation
  }
}
