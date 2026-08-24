/**
 * Session-owned refinement sidecar runtime, provider registries, and Remote evidence API.
 * @module dsh-plugin-rear
 */

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { refinementDomainSpec } from './spec.ts'
import type {
  RefinementCandidateInput,
  RefinementComparisonRequest,
  RefinementDriver,
  RefinementDriverCapabilities,
  RefinementDriverOperation,
  RefinementEvidenceProvider,
  RefinementIterationInput,
} from './providers.ts'
import { RefinementProviderError } from './providers.ts'
import type {
  CanonicalTrajectoryDocument,
  RefinementBusinessFailure,
  RefinementCancelRequest,
  RefinementCancelResult,
  RefinementCancelValue,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementChangeToken,
  RefinementEvaluationProjection,
  RefinementEvaluationRef,
  RefinementEvaluationRequest,
  RefinementEvaluationResult,
  RefinementEvaluationView,
  RefinementFailure,
  RefinementGetRequest,
  RefinementGetResult,
  RefinementId,
  RefinementIterationId,
  RefinementIterationRecord,
  RefinementListRequest,
  RefinementListResult,
  RefinementListValue,
  RefinementProviderEvidencePage,
  RefinementProviderEvidenceRequest,
  RefinementProviderEvidenceResult,
  RefinementRecordV1,
  RefinementRejected,
  RefinementSessionIdentity,
  RefinementStartRequest,
  RefinementStartResult,
  RefinementStartValue,
  RefinementSuccess,
  RefinementSummary,
  RefinementTrajectoryRequest,
  RefinementTrajectoryResult,
  RefinementVersion,
} from './types.ts'

export type * from './types.ts'
export type * from './providers.ts'
export { RefinementProviderError } from './providers.ts'
export { refinementDomainSpec, refinementRecordSchema } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    refinements: RefinementRuntime
  }
}

/** Required provider selection and response-size policy. */
export interface Config {
  /** Exact registered driver id used for every new refinement. */
  readonly driver: string
  /** Exact registered evidence-provider id used for every new refinement. */
  readonly evidenceProvider: string
  /** Maximum accepted UTF-8 objective size. */
  readonly objectiveMaxBytes: number
  /** Maximum serialized canonical trajectory response size. */
  readonly trajectoryResponseMaxBytes: number
  /** Maximum serialized provider-native evidence page size. */
  readonly providerEvidencePageMaxBytes: number
}

interface RunningOperation {
  readonly controller: AbortController
  readonly done: Promise<void>
}

type InternalResult<T> = { readonly ok: true; readonly value: T } | RefinementRejected

const TERMINAL = new Set<RefinementRecordV1['status']>(['completed', 'failed', 'cancelled'])

/** Return a deeply immutable detached JSON-compatible snapshot. */
function snapshot<T>(value: T): T {
  const copied = structuredClone(value)
  const pending: object[] = []
  if (copied !== null && typeof copied === 'object') pending.push(copied)
  while (pending.length > 0) {
    // The length check proves one object remains.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = pending.pop()!
    for (const child of Object.values(current as Record<string, unknown>)) {
      if (child !== null && typeof child === 'object') pending.push(child)
    }
    Object.freeze(current)
  }
  return copied
}

/** Build an immutable success branch. */
function success<T>(value: T): RefinementSuccess<T> {
  return Object.freeze({ ok: true, value: snapshot(value) })
}

/** Build an immutable business failure branch. */
function rejected(code: RefinementBusinessFailure['code'], message: string): RefinementRejected {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

/** Generate one branded equality token. */
function version(): RefinementVersion {
  return randomUUID() as RefinementVersion
}

/** Generate one event invalidation token. */
function changeToken(): RefinementChangeToken {
  return randomUUID() as RefinementChangeToken
}

/** Project the fields that distinguish a reused Session id. */
function identityOf(header: SessionHeader): RefinementSessionIdentity {
  return Object.freeze({
    sessionId: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  })
}

/** Compare a sidecar owner against one exact Session lifecycle. */
function sameLifecycle(record: RefinementRecordV1, header: SessionHeader): boolean {
  return record.session.sessionId === header.id
    && record.session.createdAt === header.createdAt
    && record.session.cwd === header.cwd
}

/** Build the exact lifecycle key used by the in-memory Session index. */
function lifecycleKey(identity: RefinementSessionIdentity): string {
  return JSON.stringify([identity.sessionId, identity.createdAt, identity.cwd ?? null])
}

/** Convert a record to the bounded list projection. */
function summaryOf(record: RefinementRecordV1): RefinementSummary {
  return {
    id: record.id,
    objective: record.objective,
    status: record.status,
    activeIterationId: record.activeIterationId,
    iterationCount: record.iterations.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: record.version,
    ...(record.failure === undefined ? {} : { failure: record.failure }),
  }
}

/** Validate a positive deployment byte limit. */
function byteLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`refinement: ${name} must be a positive safe integer, got ${String(value)}`)
  }
  return value
}

/** Validate one required provider id. */
function providerId(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`refinement: ${name} must be a non-empty provider id`)
  }
  return value.trim()
}

/** Host refinement service with durable lifecycle and read-only evidence projection. */
export class RefinementRuntime extends Service {
  static inject = ['storageDomain', 'sessions']

  /** Loader validation for explicit provider selection and response bounds. */
  static Config: s<Config> = s.object({
    driver: s.string().required(),
    evidenceProvider: s.string().required(),
    objectiveMaxBytes: s.number().step(1).min(1).required(),
    trajectoryResponseMaxBytes: s.number().step(1).min(1).required(),
    providerEvidencePageMaxBytes: s.number().step(1).min(1).required(),
  })

  private readonly configuredDriver: string
  private readonly configuredEvidenceProvider: string
  private readonly objectiveMaxBytes: number
  private readonly trajectoryResponseMaxBytes: number
  private readonly providerEvidencePageMaxBytes: number
  private readonly drivers = new Map<string, RefinementDriver>()
  private readonly evidenceProviders = new Map<string, RefinementEvidenceProvider>()
  private readonly mutationTails = new Map<RefinementId, Promise<void>>()
  private readonly operations = new Map<RefinementId, RunningOperation>()
  private readonly watches = new Map<string, () => void>()
  private readonly sessionIndex = new Map<string, Set<RefinementId>>()
  private table?: KvTable<RefinementId, RefinementRecordV1>
  private admissionOpen = true
  private lastTimestamp = 0

  /** @param ctx - Host service context. @param config - explicit provider and byte-limit policy. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'refinements')
    this.configuredDriver = providerId('driver', config.driver)
    this.configuredEvidenceProvider = providerId('evidenceProvider', config.evidenceProvider)
    this.objectiveMaxBytes = byteLimit('objectiveMaxBytes', config.objectiveMaxBytes)
    this.trajectoryResponseMaxBytes = byteLimit('trajectoryResponseMaxBytes', config.trajectoryResponseMaxBytes)
    this.providerEvidencePageMaxBytes = byteLimit('providerEvidencePageMaxBytes', config.providerEvidencePageMaxBytes)
  }

  /** Open the sidecar domain and own complete asynchronous teardown. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(refinementDomainSpec)
    this.table = domain.table('refinements')
    for (const [, record] of this.table.entries()) {
      this.lastTimestamp = Math.max(this.lastTimestamp, record.updatedAt)
      this.addToSessionIndex(record)
    }
    this.ctx.effect(() => async () => {
      this.admissionOpen = false
      for (const dispose of this.watches.values()) dispose()
      this.watches.clear()
      for (const operation of this.operations.values()) operation.controller.abort('refinement runtime disposed')
      await Promise.all([...this.operations.values()].map(operation => operation.done))
      await Promise.all(this.mutationTails.values())
      await domain.close()
    }, 'refinement.domainClose')
    this.recoverAvailableRecords()
  }

  /**
   * Register one uniquely named driver.
   * @param driver - candidate-generation provider.
   * @returns idempotent registry disposer; callers attach it to their own effect.
   */
  registerDriver(driver: RefinementDriver): () => void {
    this.assertProviderShape('driver', driver)
    if (this.drivers.has(driver.id)) throw new Error(`refinement driver "${driver.id}" is already registered`)
    this.drivers.set(driver.id, driver)
    this.recoverAvailableRecords()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.drivers.get(driver.id) === driver) this.drivers.delete(driver.id)
    }
  }

  /**
   * Register one uniquely named evidence provider.
   * @param provider - read-only evaluation evidence adapter.
   * @returns idempotent registry disposer; callers attach it to their own effect.
   */
  registerEvidenceProvider(provider: RefinementEvidenceProvider): () => void {
    this.assertProviderShape('evidence provider', provider)
    if (this.evidenceProviders.has(provider.id)) {
      throw new Error(`refinement evidence provider "${provider.id}" is already registered`)
    }
    this.evidenceProviders.set(provider.id, provider)
    this.restoreWatches(provider)
    this.recoverAvailableRecords()
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.evidenceProviders.get(provider.id) !== provider) return
      this.evidenceProviders.delete(provider.id)
      for (const [key, dispose] of this.watches) {
        if (!key.startsWith(`${provider.id}\u0000`)) continue
        dispose()
        this.watches.delete(key)
      }
    }
  }

  /**
   * Persist admission and schedule background work without waiting for evaluation.
   * @param agent - exact live Session owner and driver launch context.
   * @param request - optional normalized objective.
   * @param signal - command request cancellation, honored only before admission commits.
   * @returns durable identity plus the linking Session event seq, or an admission failure.
   */
  async start(agent: Agent, request: RefinementStartRequest, signal: AbortSignal): Promise<RefinementStartResult> {
    if (!this.admissionOpen) throw new Error('refinement: service is disposing')
    if (signal.aborted) throw this.abortError(signal)
    const driver = this.resolveConfiguredDriver()
    if (!driver.ok) return driver
    const provider = this.resolveConfiguredEvidenceProvider()
    if (!provider.ok) return provider
    const objective = request.objective === null ? null : request.objective.trim()
    const actualBytes = objective === null ? 0 : Buffer.byteLength(objective, 'utf8')
    if (actualBytes > this.objectiveMaxBytes) {
      return rejected(
        'objective-too-large',
        `refinement objective is ${actualBytes} UTF-8 bytes; limit is ${this.objectiveMaxBytes}`,
      )
    }
    const table = this.requireTable()
    const id = `refinement-${randomUUID()}` as RefinementId
    const now = this.now()
    const record = snapshot<RefinementRecordV1>({
      schemaVersion: 1,
      id,
      session: identityOf(agent.session.header),
      objective: objective === '' ? null : objective,
      driver: { id: driver.value.id, operationId: null },
      evidenceProviderId: provider.value.id,
      status: 'queued',
      baselineCandidateId: null,
      activeIterationId: null,
      candidates: [],
      iterations: [],
      createdAt: now,
      updatedAt: now,
      version: version(),
    })
    await table.put(id, record)
    this.addToSessionIndex(record)
    let sourceEventSeq: number
    try {
      sourceEventSeq = agent.session.append('refinement/created', { refinementId: id }).seq
    } catch (error) {
      await table.delete(id)
      this.removeFromSessionIndex(record)
      throw error
    }
    this.emitChange(record)
    this.runDriver(driver.value, record, agent, false)
    return success<RefinementStartValue>({ refinementId: id, sourceEventSeq })
  }

  /**
   * List lightweight sidecars belonging to one exact live Session lifecycle.
   * @param request - current Session selection.
   * @returns Owned refinement summaries.
   */
  list(request: RefinementListRequest): RefinementListResult {
    const header = this.ctx.sessions.get(request.sessionId)?.header
    if (header === undefined) return rejected('refinement-not-found', 'refinement Session was not found')
    const key = lifecycleKey(identityOf(header))
    const records = [...(this.sessionIndex.get(key) ?? [])]
      .flatMap((id) => {
        const record = this.requireTable().get(id)
        return record === undefined ? [] : [record]
      })
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(summaryOf)
    return success<RefinementListValue>({ records })
  }

  /**
   * Return one complete sidecar after lifecycle ownership validation.
   * @param request - Session and refinement identity.
   * @returns Owned refinement detail or a typed rejection.
   */
  get(request: RefinementGetRequest): RefinementGetResult {
    const owned = this.ownedRecord(request)
    return owned.ok ? success(owned.value) : owned
  }

  /**
   * Request idempotent driver cancellation with compare-and-set protection.
   * @param request - lifecycle identity and expected version.
   * @returns Cancellation state and authoritative record.
   */
  cancel(request: RefinementCancelRequest): Promise<RefinementCancelResult> {
    return this.enqueue(request.refinementId, async () => {
      const owned = this.ownedRecord(request)
      if (!owned.ok) return owned
      const current = owned.value
      if (current.version !== request.ifVersion) {
        return rejected('version-conflict', 'refinement changed after the requested version')
      }
      if (TERMINAL.has(current.status)) {
        return success<RefinementCancelValue>({ state: 'already-terminal', record: current })
      }
      const driver = this.drivers.get(current.driver.id)
      if (driver === undefined || !driver.available()) {
        return rejected('cancel-unavailable', `refinement driver "${current.driver.id}" cannot cancel this operation`)
      }
      const state = await driver.cancel(snapshot(current))
      if (state !== 'stopped') return success<RefinementCancelValue>({ state, record: current })
      this.operations.get(current.id)?.controller.abort('refinement cancelled')
      const next = await this.commit(current, {
        ...current,
        status: 'cancelled',
        activeIterationId: null,
        completedAt: this.nowAfter(current.updatedAt),
      })
      return success<RefinementCancelValue>({ state, record: next })
    })
  }

  /**
   * Load all evaluation summaries and a provider-owned comparison for one iteration.
   * @param request - owned iteration comparison selection.
   * @returns Evidence summaries and provider comparison.
   */
  async evaluation(request: RefinementEvaluationRequest): Promise<RefinementEvaluationResult> {
    const selection = this.iterationSelection(request)
    if (!selection.ok) return selection
    const { provider, refs } = selection.value
    try {
      const evaluations = await Promise.all(refs.map(ref => provider.evaluation(snapshot(ref))))
      evaluations.forEach((evaluation, index) => {
        this.assertEvaluationProjection(refs[index], evaluation)
      })
      const comparisonRequest: RefinementComparisonRequest = {
        refs: snapshot(refs),
        dimension: request.dimension,
        referenceRunId: request.referenceRunId,
      }
      const comparison = await provider.compare(comparisonRequest)
      const value: RefinementEvaluationView = {
        evidenceVersion: randomUUID(),
        evaluations,
        comparison,
      }
      return success(value)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /**
   * Load one validated canonical trajectory belonging to a referenced evaluation.
   * @param request - owned run lookup.
   * @returns Bounded canonical Session document.
   */
  async trajectory(request: RefinementTrajectoryRequest): Promise<RefinementTrajectoryResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const document = await lookup.value.provider.trajectory({
        evalRef: snapshot(lookup.value.ref),
        runId: request.runId,
      })
      if (document.runId !== request.runId) throw new Error('refinement provider returned a trajectory for another run')
      if (Buffer.byteLength(JSON.stringify(document), 'utf8') > this.trajectoryResponseMaxBytes) {
        return rejected('response-too-large', 'canonical trajectory exceeds the configured response limit')
      }
      return success<CanonicalTrajectoryDocument>(document)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /**
   * Load one bounded provider-native evidence page belonging to a referenced run.
   * @param request - owned run and evidence page lookup.
   * @returns Bounded provider-native evidence page.
   */
  async providerEvidence(request: RefinementProviderEvidenceRequest): Promise<RefinementProviderEvidenceResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const page = await lookup.value.provider.providerEvidence({
        evalRef: snapshot(lookup.value.ref),
        runId: request.runId,
        fileOrdinal: request.fileOrdinal,
        cursor: request.cursor,
        maxBytes: this.providerEvidencePageMaxBytes,
      })
      if (page.runId !== request.runId) throw new Error('refinement provider returned evidence for another run')
      if (Buffer.byteLength(JSON.stringify(page), 'utf8') > this.providerEvidencePageMaxBytes) {
        return rejected('response-too-large', 'provider evidence page exceeds the configured response limit')
      }
      return success<RefinementProviderEvidencePage>(page)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /** Resolve a driver exactly by configured id; never select by registry order. */
  private resolveConfiguredDriver(): InternalResult<RefinementDriver> {
    const driver = this.drivers.get(this.configuredDriver)
    return driver !== undefined && driver.available()
      ? { ok: true, value: driver }
      : rejected('driver-unavailable', `configured refinement driver "${this.configuredDriver}" is unavailable`)
  }

  /** Resolve evidence exactly by configured id; never select by registry order. */
  private resolveConfiguredEvidenceProvider(): InternalResult<RefinementEvidenceProvider> {
    const provider = this.evidenceProviders.get(this.configuredEvidenceProvider)
    return provider !== undefined && provider.available()
      ? { ok: true, value: provider }
      : rejected(
        'evidence-provider-unavailable',
        `configured refinement evidence provider "${this.configuredEvidenceProvider}" is unavailable`,
      )
  }

  /** Validate registry identity and callable availability before insertion. */
  private assertProviderShape(kind: string, provider: { readonly id: string; available(): boolean }): void {
    if (typeof provider.id !== 'string' || provider.id.trim().length === 0) {
      throw new TypeError(`refinement ${kind} id must be a non-empty string`)
    }
    if (typeof provider.available !== 'function') {
      throw new TypeError(`refinement ${kind} "${provider.id}" must implement available()`)
    }
  }

  /** Validate current lifecycle and return a detached record without leaking another Session's id. */
  private ownedRecord(request: RefinementGetRequest): RefinementSuccess<RefinementRecordV1> | RefinementRejected {
    const header = this.ctx.sessions.get(request.sessionId)?.header
    const record = this.requireTable().get(request.refinementId)
    if (header === undefined || record === undefined || !sameLifecycle(record, header)) {
      return rejected('refinement-not-found', 'refinement was not found in this Session')
    }
    return success(record)
  }

  /** Resolve one iteration and its fixed evidence provider. */
  private iterationSelection(request: RefinementEvaluationRequest): InternalResult<{
    provider: RefinementEvidenceProvider
    refs: readonly RefinementEvaluationRef[]
  }> {
    const owned = this.ownedRecord(request)
    if (!owned.ok) return owned
    const iteration = owned.value.iterations.find(item => item.id === request.iterationId)
    if (iteration === undefined) return rejected('evaluation-not-found', 'refinement iteration was not found')
    const provider = this.evidenceProviders.get(owned.value.evidenceProviderId)
    if (provider === undefined || !provider.available()) {
      return rejected('evidence-provider-unavailable', `evidence provider "${owned.value.evidenceProviderId}" is unavailable`)
    }
    return { ok: true, value: { provider, refs: iteration.evaluationRefs } }
  }

  /** Find the exact evaluation ref that owns a selected run before provider lookup. */
  private async runLookup(request: RefinementTrajectoryRequest): Promise<InternalResult<{
    provider: RefinementEvidenceProvider
    ref: RefinementEvaluationRef
  }>> {
    const owned = this.ownedRecord(request)
    if (!owned.ok) return owned
    const provider = this.evidenceProviders.get(owned.value.evidenceProviderId)
    if (provider === undefined || !provider.available()) {
      return rejected('evidence-provider-unavailable', `evidence provider "${owned.value.evidenceProviderId}" is unavailable`)
    }
    const refs = owned.value.iterations.flatMap(iteration => iteration.evaluationRefs)
    for (const ref of refs) {
      let evaluation: RefinementEvaluationProjection
      try {
        evaluation = await provider.evaluation(snapshot(ref))
      } catch (error) {
        if (error instanceof RefinementProviderError && error.code === 'evaluation-not-found') continue
        const failure = this.providerFailure(error)
        return failure
      }
      this.assertEvaluationProjection(ref, evaluation)
      if (evaluation.runs.some(run => run.id === request.runId)) {
        return { ok: true, value: { provider, ref } }
      }
    }
    return rejected('run-not-found', 'run is not referenced by this refinement')
  }

  /** Assert that a provider projection cannot cross an evaluation or candidate owner. */
  private assertEvaluationProjection(ref: RefinementEvaluationRef | undefined, value: RefinementEvaluationProjection): void {
    if (ref === undefined
      || value.ref.evalId !== ref.evalId
      || value.ref.candidateId !== ref.candidateId
      || value.ref.providerId !== ref.providerId
      || value.runs.some(run => run.evalId !== ref.evalId || run.candidateId !== ref.candidateId)) {
      throw new Error('refinement evidence provider returned a projection outside its requested ownership')
    }
  }

  /** Preserve provider business codes while infrastructure failures remain thrown. */
  private providerFailure(error: unknown): RefinementRejected {
    if (error instanceof RefinementProviderError) return rejected(error.code, error.message)
    throw error
  }

  /** Begin a fresh or resumed driver operation and retain teardown ownership. */
  private runDriver(driver: RefinementDriver, record: RefinementRecordV1, agent: Agent | null, resumed: boolean): void {
    if (!this.admissionOpen || this.operations.has(record.id)) return
    const controller = new AbortController()
    const done = this.drive(driver, record, agent, controller, resumed).catch((error: unknown) => {
      this.ctx.logger.warn(`refinement "${record.id}": driver failed: ${String(error)}`)
    }).finally(() => {
      if (this.operations.get(record.id)?.controller === controller) this.operations.delete(record.id)
    })
    this.operations.set(record.id, { controller, done })
  }

  /** Execute one driver and convert an uncommitted failure into durable state. */
  private async drive(
    driver: RefinementDriver,
    initial: RefinementRecordV1,
    agent: Agent | null,
    controller: AbortController,
    resumed: boolean,
  ): Promise<void> {
    let record = initial
    try {
      if (!resumed && record.status === 'queued') {
        record = await this.mutate(record.id, record.version, current => ({ ...current, status: 'running' }))
      }
      const operation: RefinementDriverOperation = Object.freeze({
        agent,
        record: snapshot(record),
        signal: controller.signal,
        capabilities: this.capabilities(record.id),
      })
      if (resumed) await driver.resume(operation)
      else await driver.run(operation)
      const current = this.requireTable().get(record.id)
      if (current !== undefined && (current.status === 'queued' || current.status === 'running')) {
        await this.failIfActive(current.id, {
          code: 'driver-incomplete',
          message: `refinement driver "${driver.id}" returned without ending the refinement`,
        })
      }
    } catch (error) {
      const current = this.requireTable().get(record.id)
      if (current !== undefined && !TERMINAL.has(current.status)) {
        await this.failIfActive(current.id, {
          code: controller.signal.aborted ? 'driver-cancelled' : 'driver-failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  /** Construct mutation callbacks scoped to one operation identity. */
  private capabilities(id: RefinementId): RefinementDriverCapabilities {
    const capabilities: RefinementDriverCapabilities = {
      setOperationId: (expected, operationId) => this.mutate(id, expected, current => ({
        ...current,
        driver: { ...current.driver, operationId: this.nonEmpty('operationId', operationId) },
      })),
      addCandidate: (expected, candidate) => this.addCandidate(id, expected, candidate),
      beginIteration: (expected, iteration) => this.beginIteration(id, expected, iteration),
      attachEvaluation: (expected, iterationId, ref) => this.attachEvaluation(id, expected, iterationId, ref),
      settleIteration: (expected, iterationId, status, failure) =>
        this.settleIteration(id, expected, iterationId, status, failure),
      finish: (expected, status, failure) => this.finish(id, expected, status, failure),
    }
    return Object.freeze(capabilities)
  }

  /** Add one runtime-identified candidate after lineage validation. */
  private addCandidate(
    id: RefinementId,
    expected: RefinementVersion,
    input: RefinementCandidateInput,
  ): Promise<RefinementRecordV1> {
    return this.mutate(id, expected, (current) => {
      if (input.parentCandidateId !== null && !current.candidates.some(item => item.id === input.parentCandidateId)) {
        throw new Error('refinement candidate parent is absent')
      }
      if (input.role === 'baseline' && current.baselineCandidateId !== null) {
        throw new Error('refinement already has a baseline candidate')
      }
      const candidate: RefinementCandidateRecord = {
        id: `candidate-${randomUUID()}` as RefinementCandidateId,
        role: input.role,
        parentCandidateId: input.parentCandidateId,
        requestedHarnessRef: this.nonEmpty('requestedHarnessRef', input.requestedHarnessRef),
        revisionIdentity: input.revisionIdentity,
        label: this.nonEmpty('candidate label', input.label),
        createdAt: this.nowAfter(current.updatedAt),
      }
      return {
        ...current,
        baselineCandidateId: input.role === 'baseline' ? candidate.id : current.baselineCandidateId,
        candidates: [...current.candidates, candidate],
      }
    })
  }

  /** Begin the next ordered iteration after candidate ownership validation. */
  private beginIteration(
    id: RefinementId,
    expected: RefinementVersion,
    input: RefinementIterationInput,
  ): Promise<RefinementRecordV1> {
    return this.mutate(id, expected, (current) => {
      if (current.activeIterationId !== null) throw new Error('refinement already has an active iteration')
      if (input.candidateIds.length === 0
        || input.candidateIds.some(candidateId => !current.candidates.some(item => item.id === candidateId))) {
        throw new Error('refinement iteration candidates are empty or not owned by this refinement')
      }
      const iteration: RefinementIterationRecord = {
        id: `iteration-${randomUUID()}` as RefinementIterationId,
        ordinal: current.iterations.length + 1,
        status: 'preparing',
        candidateIds: [...new Set(input.candidateIds)],
        evaluationRefs: [],
        createdAt: this.nowAfter(current.updatedAt),
      }
      return {
        ...current,
        status: 'running',
        activeIterationId: iteration.id,
        iterations: [...current.iterations, iteration],
      }
    })
  }

  /** Associate one external evaluation exactly once and install its evidence watch. */
  private async attachEvaluation(
    id: RefinementId,
    expected: RefinementVersion,
    iterationId: RefinementIterationId,
    ref: RefinementEvaluationRef,
  ): Promise<RefinementRecordV1> {
    const next = await this.mutate(id, expected, (current) => {
      if (ref.providerId !== current.evidenceProviderId) throw new Error('evaluation provider differs from refinement provider')
      const index = current.iterations.findIndex(item => item.id === iterationId)
      const iteration = current.iterations[index]
      if (iteration === undefined || !iteration.candidateIds.includes(ref.candidateId)) {
        throw new Error('evaluation candidate is outside the selected iteration')
      }
      if (current.iterations.some(item => item.evaluationRefs.some(existing => existing.evalId === ref.evalId))) {
        throw new Error('evaluation is already associated with this refinement')
      }
      const iterations = [...current.iterations]
      iterations[index] = { ...iteration, status: 'evaluating', evaluationRefs: [...iteration.evaluationRefs, snapshot(ref)] }
      return { ...current, iterations }
    })
    this.attachWatch(next, ref)
    return next
  }

  /** Settle one active iteration while retaining its evidence references. */
  private settleIteration(
    id: RefinementId,
    expected: RefinementVersion,
    iterationId: RefinementIterationId,
    status: Extract<RefinementIterationRecord['status'], 'settled' | 'failed' | 'cancelled'>,
    failure?: RefinementFailure,
  ): Promise<RefinementRecordV1> {
    return this.mutate(id, expected, (current) => {
      const index = current.iterations.findIndex(item => item.id === iterationId)
      const iteration = current.iterations[index]
      if (iteration === undefined) throw new Error('refinement iteration is absent')
      if (['settled', 'failed', 'cancelled'].includes(iteration.status)) throw new Error('refinement iteration is already terminal')
      const completedAt = this.nowAfter(current.updatedAt)
      const iterations = [...current.iterations]
      iterations[index] = {
        ...iteration,
        status,
        completedAt,
        ...(failure === undefined ? {} : { failure: snapshot(failure) }),
      }
      return {
        ...current,
        activeIterationId: current.activeIterationId === iterationId ? null : current.activeIterationId,
        iterations,
      }
    })
  }

  /** End or yield the refinement after rejecting invalid failure combinations. */
  private finish(
    id: RefinementId,
    expected: RefinementVersion,
    status: Extract<RefinementRecordV1['status'], 'awaiting-review' | 'completed' | 'failed' | 'cancelled'>,
    failure?: RefinementFailure,
  ): Promise<RefinementRecordV1> {
    return this.mutate(id, expected, (current) => {
      if ((status === 'failed') !== (failure !== undefined)) {
        throw new Error('only a failed refinement carries a failure')
      }
      const timestamp = this.nowAfter(current.updatedAt)
      return {
        ...current,
        status,
        activeIterationId: null,
        ...(status === 'awaiting-review' ? {} : { completedAt: timestamp }),
        ...(failure === undefined ? {} : { failure: snapshot(failure) }),
      }
    })
  }

  /** Fail a still-active record using its current authoritative version. */
  private async failIfActive(id: RefinementId, failure: RefinementFailure): Promise<void> {
    const current = this.requireTable().get(id)
    if (current === undefined || TERMINAL.has(current.status)) return
    try {
      await this.mutate(id, current.version, record => ({
        ...record,
        status: 'failed',
        activeIterationId: null,
        completedAt: this.nowAfter(record.updatedAt),
        failure: snapshot(failure),
      }))
    } catch (error) {
      this.ctx.logger.warn(`refinement "${id}": unable to persist failure: ${String(error)}`)
    }
  }

  /** Serialize a compare-and-set mutation by refinement identity. */
  private mutate(
    id: RefinementId,
    expected: RefinementVersion,
    update: (current: RefinementRecordV1) => RefinementRecordV1,
  ): Promise<RefinementRecordV1> {
    return this.enqueue(id, async () => {
      const current = this.requireTable().get(id)
      if (current === undefined) throw new Error(`refinement "${id}" was not found`)
      if (current.version !== expected) throw new Error(`refinement "${id}" version conflict`)
      if (TERMINAL.has(current.status)) throw new Error(`refinement "${id}" is already terminal`)
      return await this.commit(current, update(snapshot(current)))
    })
  }

  /** Commit one detached whole-row replacement before publishing invalidation. */
  private async commit(current: RefinementRecordV1, candidate: RefinementRecordV1): Promise<RefinementRecordV1> {
    const next = snapshot<RefinementRecordV1>({
      ...candidate,
      id: current.id,
      schemaVersion: 1,
      session: current.session,
      driver: { ...candidate.driver, id: current.driver.id },
      evidenceProviderId: current.evidenceProviderId,
      createdAt: current.createdAt,
      updatedAt: this.nowAfter(current.updatedAt),
      version: version(),
    })
    await this.requireTable().put(current.id, next)
    this.emitChange(next)
    return snapshot(next)
  }

  /** Queue one complete read/compare/write operation behind prior mutations. */
  private enqueue<T>(id: RefinementId, operation: () => Promise<T>): Promise<T> {
    if (!this.admissionOpen) return Promise.reject(new Error('refinement: service is disposing'))
    const previous = this.mutationTails.get(id) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.mutationTails.set(id, tail)
    return result.finally(() => {
      if (this.mutationTails.get(id) === tail) this.mutationTails.delete(id)
    })
  }

  /** Attach exactly one provider watch for one referenced evaluation. */
  private attachWatch(record: RefinementRecordV1, ref: RefinementEvaluationRef): void {
    const provider = this.evidenceProviders.get(ref.providerId)
    if (provider === undefined || !provider.available()) {
      throw new Error(`refinement evidence provider "${ref.providerId}" is unavailable for watch`)
    }
    const key = `${ref.providerId}\u0000${record.id}\u0000${ref.evalId}`
    if (this.watches.has(key)) return
    const dispose = provider.watch(snapshot(ref), () => {
      const current = this.requireTable().get(record.id)
      if (current !== undefined) this.emitChange(current)
    })
    this.watches.set(key, dispose)
  }

  /** Restore watches owned by one newly available provider. */
  private restoreWatches(provider: RefinementEvidenceProvider): void {
    if (this.table === undefined || !provider.available()) return
    for (const [, record] of this.table.entries()) {
      if (record.evidenceProviderId !== provider.id) continue
      for (const ref of record.iterations.flatMap(iteration => iteration.evaluationRefs)) {
        try {
          this.attachWatch(record, ref)
        } catch (error) {
          void this.failIfActive(record.id, { code: 'evidence-watch-failed', message: String(error) })
        }
      }
    }
  }

  /** Resume every non-terminal row once both fixed providers are available. */
  private recoverAvailableRecords(): void {
    if (this.table === undefined || !this.admissionOpen) return
    for (const [, record] of this.table.entries()) {
      if (TERMINAL.has(record.status) || this.operations.has(record.id)) continue
      const owner = this.ctx.sessions.get(record.session.sessionId)?.header
      if (owner === undefined || !sameLifecycle(record, owner)) {
        void this.failIfActive(record.id, {
          code: 'session-lifecycle-mismatch',
          message: `refinement Session lifecycle "${record.session.sessionId}" is unavailable`,
        })
        continue
      }
      const driver = this.drivers.get(record.driver.id)
      const provider = this.evidenceProviders.get(record.evidenceProviderId)
      if (driver === undefined || provider === undefined || !driver.available() || !provider.available()) continue
      let watchFailed = false
      for (const ref of record.iterations.flatMap(iteration => iteration.evaluationRefs)) {
        try {
          this.attachWatch(record, ref)
        } catch (error) {
          watchFailed = true
          void this.failIfActive(record.id, { code: 'evidence-watch-failed', message: String(error) })
          break
        }
      }
      if (watchFailed) continue
      this.runDriver(driver, record, null, true)
    }
  }

  /** Publish post-commit invalidation while containing observer failures. */
  private emitChange(record: RefinementRecordV1): void {
    try {
      this.ctx.emit('refinement/change', record.session.sessionId, record.id, changeToken())
    } catch (error) {
      this.ctx.logger.warn(`refinement "${record.id}": change listener failed: ${String(error)}`)
    }
  }

  /** Add one durable row to the rebuilt exact-lifecycle Session index. */
  private addToSessionIndex(record: RefinementRecordV1): void {
    const key = lifecycleKey(record.session)
    let ids = this.sessionIndex.get(key)
    if (ids === undefined) {
      ids = new Set()
      this.sessionIndex.set(key, ids)
    }
    ids.add(record.id)
  }

  /** Remove a rolled-back admission from the exact-lifecycle Session index. */
  private removeFromSessionIndex(record: RefinementRecordV1): void {
    const key = lifecycleKey(record.session)
    const ids = this.sessionIndex.get(key)
    if (ids === undefined) return
    ids.delete(record.id)
    if (ids.size === 0) this.sessionIndex.delete(key)
  }

  /** Return a monotonic Host timestamp. */
  private now(): number {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1)
    return this.lastTimestamp
  }

  /** Return a monotonic Host timestamp strictly after a record value. */
  private nowAfter(previous: number): number {
    this.lastTimestamp = Math.max(Date.now(), this.lastTimestamp + 1, previous + 1)
    return this.lastTimestamp
  }

  /** Validate one non-empty driver-owned string. */
  private nonEmpty(label: string, value: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError(`refinement ${label} must be a non-empty string`)
    }
    return value
  }

  /** Resolve the initialized durable table or fail a broken service lifecycle. */
  private requireTable(): KvTable<RefinementId, RefinementRecordV1> {
    if (this.table === undefined) throw new Error('refinement: durable domain is not initialized')
    return this.table
  }

  /** Normalize one abort reason without changing its ownership. */
  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new Error(typeof signal.reason === 'string' ? signal.reason : 'refinement admission aborted')
  }
}

export default RefinementRuntime
