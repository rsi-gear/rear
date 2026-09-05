/**
 * Read-only projection of Gear evolution state and Hitch run evidence.
 * @module dsh-plugin-rear
 */

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  watch,
  type FSWatcher,
} from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type SessionStore from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import './legacy-session-compat.ts'
import { trajectoryPage } from './trajectory-pages.ts'
import {
  HitchRefinementEvidenceProvider,
  type Config as HitchConfig,
} from './hitch-provider.ts'
import { RefinementProviderError } from './providers.ts'
import type {
  CanonicalTrajectoryDocument,
  HitchEvalId,
  RefinementBusinessFailure,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementChangeToken,
  RefinementEvaluationRef,
  RefinementEvaluationRequest,
  RefinementEvaluationResult,
  RefinementEvaluationView,
  RefinementFailure,
  RefinementGetRequest,
  RefinementGetResult,
  RefinementId,
  RefinementInteractionEvidencePage,
  RefinementInteractionEvidenceRequest,
  RefinementInteractionEvidenceResult,
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
  RefinementSuccess,
  RefinementSummary,
  RefinementTrajectoryRequest,
  RefinementTrajectoryResult,
  RefinementVersion,
} from './types.ts'

export type * from './types.ts'
export type * from './providers.ts'
export { RefinementProviderError } from './providers.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    refinements: RefinementRuntime
  }
}

/** Gear state source, Hitch evidence source, and response bounds. */
export interface Config {
  readonly gear: {
    /** Absolute Gear top-level `stateRoot`. */
    readonly root: string
    /** Debounce for atomic Gear state-file notifications. */
    readonly watchDebounceMs: number
  }
  readonly hitch: HitchConfig
  readonly trajectoryResponseMaxBytes: number
  readonly providerEvidencePageMaxBytes: number
}

const SAFE_ID = /^[a-zA-Z0-9_-]+$/u
const EVAL_ID = /^eval_[0-9a-f]{32}$/u
const RUN_ID = /^run_[0-9a-f]{32}$/u
const ACTIVE_ROUND = new Set([
  'queued', 'baseline-running', 'preparing-candidate', 'candidate-editing',
  'building-candidate', 'candidate-seed-running', 'held-out-running', 'selection-running', 'promoting',
  'repairing-evaluation',
])
const SETTLED_ROUND = new Set(['accepted', 'rejected', 'rejected-for-substrate'])

const gearTrialSchema = z.object({
  taskName: z.string().min(1),
  trialName: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  attempt: z.number().int().positive().optional(),
}).passthrough()

const gearEvidenceSchema = z.object({
  provider: z.string().min(1),
  conditionId: z.string().min(1),
  effectiveConfigDigest: z.string().min(1),
  evalId: z.string().min(1),
  dataset: z.string().min(1),
  requestedCommit: z.string().min(1),
  actualCommit: z.string().min(1),
  revisionIdentity: z.string().min(1),
  completeness: z.enum(['complete', 'partial']),
  plannedTrialCount: z.number().int().nonnegative(),
  primaryReward: z.number().finite(),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    score: z.number().finite(),
  }).passthrough(),
  trials: z.array(gearTrialSchema),
  invalidTrials: z.array(z.object({
    taskName: z.string().min(1),
    trialName: z.string().min(1),
    runId: z.string().min(1),
    attempt: z.number().int().positive(),
    status: z.literal('errored'),
    invalidReason: z.string().min(1),
  }).passthrough()),
}).passthrough()

const gearFailedEvaluationTrialSchema = z.object({
  taskName: z.string().min(1),
  trialName: z.string().min(1),
  runId: z.string().min(1),
  attempt: z.number().int().positive(),
  status: z.string().min(1),
  invalidReason: z.string().min(1).optional(),
}).passthrough()

const gearFailedEvaluationSchema = z.object({
  phase: z.string().min(1),
  owner: z.object({
    candidateId: z.string().min(1),
    harnessRef: z.string().min(1),
    role: z.enum(['baseline', 'candidate']),
  }).passthrough(),
  evidence: z.object({
    evalId: z.string().min(1),
    provider: z.string().min(1),
    conditionId: z.string().min(1),
    effectiveConfigDigest: z.string().min(1),
    dataset: z.string().min(1),
    requestedCommit: z.string().min(1),
    actualCommit: z.string().min(1),
    revisionIdentity: z.string().min(1),
    runSetComplete: z.literal(true),
    trials: z.array(gearFailedEvaluationTrialSchema),
  }).passthrough(),
  failure: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).passthrough(),
}).passthrough()

const gearEvaluationAttemptSchema = z.object({
  provider: z.string().min(1),
  evalId: z.string().min(1),
  phase: z.enum(['seed-baseline', 'seed-candidate', 'held-out-baseline', 'held-out-candidate']),
  owner: z.object({
    candidateId: z.string().min(1),
    harnessRef: z.string().min(1),
    role: z.enum(['baseline', 'candidate']),
  }).passthrough(),
  conditionId: z.string().min(1),
  dataset: z.string().min(1),
  requestedModelId: z.string(),
  requestedCommit: z.string().min(1),
  status: z.enum(['running', 'rerunning', 'repair-completed', 'settled', 'failed', 'cancelled']),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
  reusedFromRoundId: z.string().min(1).optional(),
}).passthrough()

const gearEvaluationRepairResumeSchema = z.object({
  provider: z.string().min(1),
  evalId: z.string().min(1),
  completedAt: z.string().min(1),
}).passthrough()

const gearCandidateSchema = z.object({
  candidateId: z.string().min(1),
  parentHarnessRef: z.string().min(1),
  parentCandidateIds: z.array(z.string().min(1)),
  status: z.string().min(1),
  sealedVersion: z.object({ commitOid: z.string().min(1) }).passthrough().optional(),
  seedEvaluation: gearEvidenceSchema.optional(),
  heldOutEvaluation: gearEvidenceSchema.optional(),
  proposal: z.object({
    rationale: z.string().min(1),
    expectedOutcome: z.string().min(1),
  }).passthrough().optional(),
  failure: z.object({ phase: z.string(), message: z.string() }).optional(),
}).passthrough()

const gearRoundSchema = z.object({
  evolutionId: z.string().min(1),
  roundId: z.string().min(1),
  batchId: z.string().min(1),
  roundIndex: z.number().int().positive(),
  roundCount: z.number().int().positive(),
  status: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  targetHarnessRef: z.string().min(1),
  seedTaskRef: z.string().min(1),
  heldOutRef: z.string().min(1),
  plan: z.object({
    seed: z.object({ model: z.string().min(1), conditionId: z.string().min(1) }).passthrough(),
    heldOut: z.object({ model: z.string().min(1), conditionId: z.string().min(1) }).passthrough(),
  }).passthrough(),
  parentAllocations: z.array(z.object({
    candidateId: z.string().min(1),
    parentCandidateId: z.string().min(1),
    parentHarnessRef: z.string().min(1),
  }).passthrough()).optional(),
  parentBaselines: z.array(z.object({
    parentCandidateId: z.string().min(1),
    parentHarnessRef: z.string().min(1),
    evidence: gearEvidenceSchema,
  }).passthrough()).optional(),
  baseline: gearEvidenceSchema.optional(),
  candidatePool: z.array(gearCandidateSchema),
  promotionCandidateId: z.string().min(1).optional(),
  promotedCandidateId: z.string().min(1).optional(),
  evaluation: z.object({
    seedBaseline: gearEvidenceSchema,
    seedCandidate: gearEvidenceSchema,
    heldOutBaseline: gearEvidenceSchema.optional(),
    heldOutCandidate: gearEvidenceSchema.optional(),
  }).passthrough().optional(),
  evaluationAttempts: z.array(gearEvaluationAttemptSchema).optional(),
  evaluationRepairResume: gearEvaluationRepairResumeSchema.optional(),
  failedEvaluations: z.array(gearFailedEvaluationSchema).optional(),
  failure: z.object({ phase: z.string(), message: z.string() }).optional(),
}).passthrough()

const gearRegistrySchema = z.object({
  schemaVersion: z.literal(1),
  evolutions: z.array(z.object({
    evolutionId: z.string().min(1),
    name: z.string().min(1).optional(),
    status: z.enum(['active', 'archived']),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).passthrough()),
})

type GearEvidence = z.infer<typeof gearEvidenceSchema>
type GearFailedEvaluation = z.infer<typeof gearFailedEvaluationSchema>
type GearEvaluationAttempt = z.infer<typeof gearEvaluationAttemptSchema>
type GearEvaluationEvidence = GearEvidence | GearFailedEvaluation['evidence']
type GearRound = z.infer<typeof gearRoundSchema>
type GearRegistryEntry = z.infer<typeof gearRegistrySchema>['evolutions'][number]
type GearTrial = z.infer<typeof gearTrialSchema>

interface HitchEvalIdentity {
  readonly benchmarkId: string
  readonly benchmarkRevision: string
}

interface CandidateAccumulator {
  readonly order: number
  value: RefinementCandidateRecord
}

type InternalResult<T> = { readonly ok: true; readonly value: T } | RefinementRejected

/** Return a deeply immutable detached JSON-compatible snapshot. */
function snapshot<T>(value: T): T {
  const copied = structuredClone(value)
  const pending: object[] = []
  if (copied !== null && typeof copied === 'object') pending.push(copied)
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    for (const child of Object.values(current as Record<string, unknown>)) {
      if (child !== null && typeof child === 'object') pending.push(child)
    }
    Object.freeze(current)
  }
  return copied
}

function success<T>(value: T): RefinementSuccess<T> {
  return Object.freeze({ ok: true, value: snapshot(value) })
}

function rejected(code: RefinementBusinessFailure['code'], message: string): RefinementRejected {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

function identityOf(header: SessionHeader): RefinementSessionIdentity {
  return {
    sessionId: header.id,
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError(`Gear timestamp is invalid: ${value}`)
  return parsed
}

function byteLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`refinement: ${name} must be a positive safe integer`)
  }
  return value
}

/** Produce a stable RFC-4122-shaped equality token from authoritative bytes. */
function versionOf(value: unknown): RefinementVersion {
  const hex = createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const joined = hex.join('')
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}` as RefinementVersion
}

function refinementId(evolution: string): RefinementId {
  return `gear-evolution:${evolution}` as RefinementId
}

function evolutionId(id: RefinementId): string | null {
  const value = String(id)
  if (!value.startsWith('gear-evolution:')) return null
  const candidate = value.slice('gear-evolution:'.length)
  return SAFE_ID.test(candidate) ? candidate : null
}

function candidateId(id: string): RefinementCandidateId {
  return `gear-candidate:${id}` as RefinementCandidateId
}

function iterationId(id: string): RefinementIterationId {
  return `gear-round:${id}` as RefinementIterationId
}

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

function roundStatus(status: string): RefinementIterationRecord['status'] {
  if (status === 'failed') return 'failed'
  if (SETTLED_ROUND.has(status)) return 'settled'
  if (status === 'repairing-evaluation') return 'rerunning'
  if (status === 'baseline-running' || status === 'candidate-seed-running'
    || status === 'held-out-running' || status === 'promoting') return 'evaluating'
  return 'preparing'
}

function recordStatus(rounds: readonly GearRound[]): RefinementRecordV1['status'] {
  const latest = rounds.at(-1)
  if (latest === undefined) return 'queued'
  if (latest.status === 'failed') return 'failed'
  if (ACTIVE_ROUND.has(latest.status)) return 'running'
  return 'completed'
}

function regularJson(path: string, root: string, label: string): unknown {
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new TypeError(`${label} is not a regular file`)
  const realRoot = realpathSync(root)
  const realPath = realpathSync(path)
  const fromRoot = relative(realRoot, realPath)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new TypeError(`${label} escapes its configured root`)
  try {
    return JSON.parse(readFileSync(realPath, 'utf8'))
  } catch (error) {
    throw new TypeError(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Gear-backed read-only runtime consumed by the existing RPC and Client controller. */
export class RefinementRuntime extends Service {
  static inject = ['sessions']

  static Config: s<Config> = s.object({
    gear: s.object({
      root: s.string().required(),
      watchDebounceMs: s.number().step(1).min(1).required(),
    }).required(),
    hitch: s.object({
      id: s.string().required(),
      root: s.string().required(),
      watchDebounceMs: s.number().step(1).min(1).required(),
    }).required(),
    trajectoryResponseMaxBytes: s.number().step(1).min(1).required(),
    providerEvidencePageMaxBytes: s.number().step(1).min(1).required(),
  })

  private readonly gearRoot: string
  private readonly gearWatchDebounceMs: number
  private readonly trajectoryResponseMaxBytes: number
  private readonly providerEvidencePageMaxBytes: number
  private readonly provider: HitchRefinementEvidenceProvider
  private readonly evidenceWatches = new Map<string, { readonly ids: Set<RefinementId>; readonly dispose: () => void }>()
  private gearWatcher?: FSWatcher
  private gearTimer: ReturnType<typeof setTimeout> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'refinements')
    if (!isAbsolute(config.gear.root)) throw new TypeError('refinement-gear: root must be absolute')
    if (!Number.isSafeInteger(config.gear.watchDebounceMs) || config.gear.watchDebounceMs < 1) {
      throw new TypeError('refinement-gear: watchDebounceMs must be a positive safe integer')
    }
    const configuredRoot = resolve(config.gear.root)
    const info = lstatSync(configuredRoot)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('refinement-gear: root must be a real directory')
    this.gearRoot = realpathSync(configuredRoot)
    this.gearWatchDebounceMs = config.gear.watchDebounceMs
    this.trajectoryResponseMaxBytes = byteLimit('trajectoryResponseMaxBytes', config.trajectoryResponseMaxBytes)
    this.providerEvidencePageMaxBytes = byteLimit('providerEvidencePageMaxBytes', config.providerEvidencePageMaxBytes)
    this.provider = new HitchRefinementEvidenceProvider(config.hitch)
  }

  protected async [Service.init](): Promise<void> {
    this.readRegistry()
    try {
      this.gearWatcher = watch(this.gearRoot, { persistent: false, recursive: true }, () => this.queueGearChange())
    } catch (error) {
      this.ctx.logger.warn(`refinement-gear: state watch unavailable: ${String(error)}`)
    }
    this.ctx.effect(() => () => {
      if (this.gearTimer !== undefined) clearTimeout(this.gearTimer)
      this.gearWatcher?.close()
      for (const watched of this.evidenceWatches.values()) watched.dispose()
      this.evidenceWatches.clear()
    }, 'refinement-gear: watchers')
  }

  /** List every persisted Gear evolution; the Session only scopes the browser controller. */
  list(request: RefinementListRequest): RefinementListResult {
    const header = this.sessions().get(request.sessionId)?.header
    if (header === undefined) return rejected('refinement-not-found', 'Refine view Session was not found')
    const records = this.readRegistry()
      .map(entry => {
        try { return summaryOf(this.project(entry, header)) }
        catch (error) {
          return {
            id: `gear-evolution:${entry.evolutionId}` as RefinementId,
            objective: entry.name ?? null, status: 'failed' as const,
            activeIterationId: null, iterationCount: 0,
            createdAt: timestamp(entry.createdAt), updatedAt: timestamp(entry.updatedAt),
            version: versionOf(entry),
            failure: { code: 'invalid-experiment-evidence', message: error instanceof Error ? error.message : String(error) },
          }
        }
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
    return success<RefinementListValue>({ records })
  }

  /** Return one Gear evolution projected into the current read-only workbench model. */
  get(request: RefinementGetRequest): RefinementGetResult {
    return this.ownedRecord(request)
  }

  /** Resolve Gear-owned eval ids through Hitch and compute an evidence comparison. */
  async evaluation(request: RefinementEvaluationRequest): Promise<RefinementEvaluationResult> {
    const selection = this.iterationSelection(request)
    if (!selection.ok) return selection
    const refs = selection.value
    if (refs.length === 0) {
      return success<RefinementEvaluationView>({
        evidenceVersion: randomUUID(),
        evaluations: [],
        comparison: {
          strict: false,
          dimension: request.dimension,
          referenceRunId: null,
          exclusions: [],
          tasks: [],
        },
      })
    }
    try {
      const evaluations = await Promise.all(refs.map(ref => this.provider.evaluation(snapshot(ref))))
      const comparison = await this.provider.compare({
        refs: snapshot(refs),
        dimension: request.dimension,
        referenceRunId: request.referenceRunId,
      })
      return success<RefinementEvaluationView>({ evidenceVersion: randomUUID(), evaluations, comparison })
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /** Resolve a run only after Gear and Hitch both prove its eval membership. */
  async trajectory(request: RefinementTrajectoryRequest): Promise<RefinementTrajectoryResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const document = await this.provider.trajectory({ evalRef: lookup.value, runId: request.runId })
      if (Buffer.byteLength(JSON.stringify(document), 'utf8') > this.trajectoryResponseMaxBytes) {
        return rejected('response-too-large', 'canonical trajectory exceeds the configured response limit')
      }
      return success<CanonicalTrajectoryDocument>(document)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /** Load one bounded fragment after the same Gear/Hitch ownership checks. */
  async trajectoryPage(request: import('./types.ts').RefinementTrajectoryPageRequest): Promise<import('./types.ts').RefinementTrajectoryPageResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const document = await this.provider.trajectory({ evalRef: lookup.value, runId: request.runId })
      return success(trajectoryPage(document, request.cursor, this.trajectoryResponseMaxBytes))
    } catch (error) {
      if (error instanceof RangeError) return rejected('response-too-large', error.message)
      if (error instanceof TypeError) return rejected('trajectory-corrupt', error.message)
      return this.providerFailure(error)
    }
  }

  /** Return bounded provider-native evidence for a Gear-owned run. */
  async providerEvidence(request: RefinementProviderEvidenceRequest): Promise<RefinementProviderEvidenceResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const page = await this.provider.providerEvidence({
        evalRef: lookup.value,
        runId: request.runId,
        fileOrdinal: request.fileOrdinal,
        cursor: request.cursor,
        maxBytes: this.providerEvidencePageMaxBytes,
      })
      return success<RefinementProviderEvidencePage>(page)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  /** Return bounded, independently captured model interactions for a Gear-owned run. */
  async interactionEvidence(request: RefinementInteractionEvidenceRequest): Promise<RefinementInteractionEvidenceResult> {
    const lookup = await this.runLookup(request)
    if (!lookup.ok) return lookup
    try {
      const page = await this.provider.interactionEvidence({
        evalRef: lookup.value,
        runId: request.runId,
        cursor: request.cursor,
        maxBytes: this.providerEvidencePageMaxBytes,
      })
      return success<RefinementInteractionEvidencePage>(page)
    } catch (error) {
      return this.providerFailure(error)
    }
  }

  private readRegistry(): GearRegistryEntry[] {
    const path = join(this.gearRoot, 'registry.json')
    const parsed = gearRegistrySchema.parse(regularJson(path, this.gearRoot, 'Gear registry'))
    const ids = new Set<string>()
    for (const entry of parsed.evolutions) {
      if (!SAFE_ID.test(entry.evolutionId)) throw new TypeError(`Gear evolution id is invalid: ${entry.evolutionId}`)
      if (ids.has(entry.evolutionId)) throw new TypeError(`Gear evolution id is duplicated: ${entry.evolutionId}`)
      ids.add(entry.evolutionId)
    }
    return parsed.evolutions
  }

  private readRounds(entry: GearRegistryEntry): GearRound[] {
    const roundsRoot = join(this.gearRoot, 'evolutions', entry.evolutionId, 'rounds')
    if (!existsSync(roundsRoot)) return []
    const rootInfo = lstatSync(roundsRoot)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TypeError('Gear rounds root is invalid')
    const rounds = readdirSync(roundsRoot)
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => {
        const stem = name.slice(0, -'.json'.length)
        if (!SAFE_ID.test(stem) || basename(name) !== name) throw new TypeError(`Gear round filename is invalid: ${name}`)
        const round = gearRoundSchema.parse(regularJson(join(roundsRoot, name), this.gearRoot, `Gear round ${stem}`))
        if (round.evolutionId !== entry.evolutionId || round.roundId !== stem) {
          throw new TypeError(`Gear round ownership mismatch: ${stem}`)
        }
        return round
      })
    return rounds.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.roundId.localeCompare(right.roundId))
  }

  private project(entry: GearRegistryEntry, header: SessionHeader): RefinementRecordV1 {
    const rounds = this.readRounds(entry)
    const candidates = new Map<RefinementCandidateId, CandidateAccumulator>()
    const generated = new Set(rounds.flatMap(round => round.candidatePool.map(candidate => candidate.candidateId)))
    let nextOrder = 0
    const addCandidate = (
      rawId: string,
      role: RefinementCandidateRecord['role'],
      parentRawId: string | null,
      requestedHarnessRef: string,
      revisionIdentity: string | null,
      label: string,
      createdAt: number,
      directionSummary?: string,
      candidateStatus?: string,
      candidateFailure?: RefinementFailure,
    ): RefinementCandidateId => {
      const id = candidateId(rawId)
      const current = candidates.get(id)
      const persistedDirectionSummary = directionSummary ?? current?.value.directionSummary
      const persistedStatus = candidateStatus ?? current?.value.status
      const persistedFailure = candidateFailure ?? current?.value.failure
      const value: RefinementCandidateRecord = {
        id,
        role: current?.value.role === 'baseline' ? 'baseline' : role,
        parentCandidateId: parentRawId === null ? current?.value.parentCandidateId ?? null : candidateId(parentRawId),
        requestedHarnessRef: requestedHarnessRef || current?.value.requestedHarnessRef || rawId,
        revisionIdentity: revisionIdentity ?? current?.value.revisionIdentity ?? null,
        label: current?.value.label ?? label,
        ...(persistedStatus === undefined ? {} : { status: persistedStatus }),
        ...(persistedDirectionSummary === undefined ? {} : { directionSummary: persistedDirectionSummary }),
        ...(persistedFailure === undefined ? {} : { failure: persistedFailure }),
        createdAt: current?.value.createdAt ?? createdAt,
      }
      candidates.set(id, { order: current?.order ?? nextOrder++, value })
      return id
    }

    const iterations: RefinementIterationRecord[] = rounds.map((round, index) => {
      this.validateEvaluationAttempts(round)
      const createdAt = timestamp(round.createdAt)
      const ids: RefinementCandidateId[] = []
      for (const parent of round.parentBaselines ?? []) {
        ids.push(addCandidate(
          parent.parentCandidateId,
          generated.has(parent.parentCandidateId) ? 'candidate' : 'baseline',
          null,
          parent.parentHarnessRef,
          parent.evidence.revisionIdentity,
          `Parent ${parent.parentCandidateId}`,
          createdAt,
        ))
      }
      for (const allocation of round.parentAllocations ?? []) {
        if (!ids.includes(candidateId(allocation.parentCandidateId))) {
          ids.push(addCandidate(
            allocation.parentCandidateId,
            generated.has(allocation.parentCandidateId) ? 'candidate' : 'baseline',
            null,
            allocation.parentHarnessRef,
            null,
            `Parent ${allocation.parentCandidateId}`,
            createdAt,
          ))
        }
      }
      for (const attempt of round.evaluationAttempts ?? []) {
        const candidate = round.candidatePool.find(value => value.candidateId === attempt.owner.candidateId)
        ids.push(addCandidate(
          attempt.owner.candidateId,
          attempt.owner.role,
          candidate?.parentCandidateIds[0] ?? null,
          attempt.owner.harnessRef,
          null,
          attempt.owner.role === 'baseline'
            ? `Baseline ${attempt.owner.candidateId}`
            : `Candidate ${attempt.owner.candidateId}`,
          timestamp(attempt.startedAt),
        ))
      }
      const hasFailedBaseline = (round.failedEvaluations ?? []).some(failed => failed.owner.role === 'baseline')
      const hasAttemptBaseline = (round.evaluationAttempts ?? []).some(attempt => attempt.owner.role === 'baseline')
      if (ids.length === 0 && !hasFailedBaseline && !hasAttemptBaseline) {
        ids.push(addCandidate(
          `initial-${round.targetHarnessRef}`,
          'baseline',
          null,
          round.targetHarnessRef,
          round.baseline?.revisionIdentity ?? null,
          'Initial champion',
          createdAt,
        ))
      }
      for (const candidate of round.candidatePool) {
        ids.push(addCandidate(
          candidate.candidateId,
          'candidate',
          candidate.parentCandidateIds[0] ?? null,
          candidate.sealedVersion?.commitOid ?? candidate.parentHarnessRef,
          candidate.seedEvaluation?.revisionIdentity ?? candidate.heldOutEvaluation?.revisionIdentity ?? null,
          `Candidate ${candidate.candidateId}`,
          createdAt,
          candidate.proposal?.expectedOutcome ?? candidate.proposal?.rationale,
          candidate.status,
          candidate.failure === undefined ? undefined : {
            code: candidate.failure.phase || 'candidate-failed',
            message: candidate.failure.message,
          },
        ))
      }
      for (const failed of round.failedEvaluations ?? []) {
        ids.push(addCandidate(
          failed.owner.candidateId,
          failed.owner.role,
          null,
          failed.owner.harnessRef,
          failed.evidence.revisionIdentity,
          failed.owner.role === 'baseline'
            ? `Baseline ${failed.owner.candidateId}`
            : `Candidate ${failed.owner.candidateId}`,
          createdAt,
        ))
      }
      const fallbackBaselineId = ids.find(id => candidates.get(id)?.value.role === 'baseline') ?? ids[0] ?? null
      const refs = this.roundEvaluationRefs(round, fallbackBaselineId)
      const status = roundStatus(round.status)
      const completedAt = SETTLED_ROUND.has(round.status) || round.status === 'failed'
        ? timestamp(round.updatedAt)
        : undefined
      const proposedDirection = round.candidatePool.find(candidate => candidate.proposal !== undefined)?.proposal
      const directionSummary = proposedDirection?.expectedOutcome ?? proposedDirection?.rationale
      return {
        id: iterationId(round.roundId),
        ordinal: index + 1,
        status,
        candidateIds: [...new Set(ids)],
        evaluationRefs: refs,
        createdAt,
        ...(completedAt === undefined ? {} : { completedAt }),
        ...(directionSummary === undefined ? {} : { directionSummary }),
        ...(round.failure === undefined ? {} : {
          failure: { code: round.failure.phase || 'gear-round-failed', message: round.failure.message },
        }),
      }
    })
    const orderedCandidates = [...candidates.values()].sort((left, right) => left.order - right.order).map(item => item.value)
    const status = recordStatus(rounds)
    const latest = rounds.at(-1)
    const updatedAt = latest === undefined ? timestamp(entry.updatedAt) : timestamp(latest.updatedAt)
    const failure: RefinementFailure | undefined = latest?.failure === undefined ? undefined : {
      code: latest.failure.phase || 'gear-round-failed',
      message: latest.failure.message,
    }
    const activeIteration = [...iterations].reverse().find(iteration => iteration.status === 'preparing'
      || iteration.status === 'evaluating' || iteration.status === 'rerunning')
    const record: RefinementRecordV1 = {
      schemaVersion: 1,
      id: refinementId(entry.evolutionId),
      session: identityOf(header),
      objective: entry.name ?? `Gear evolution ${entry.evolutionId}`,
      driver: { id: 'gear', operationId: entry.evolutionId },
      evidenceProviderId: this.provider.id,
      status,
      baselineCandidateId: orderedCandidates.find(candidate => candidate.role === 'baseline')?.id ?? null,
      activeIterationId: activeIteration?.id ?? null,
      candidates: orderedCandidates,
      iterations,
      createdAt: timestamp(entry.createdAt),
      updatedAt,
      ...(status === 'completed' || status === 'failed' ? { completedAt: updatedAt } : {}),
      ...(failure === undefined ? {} : { failure }),
      version: versionOf({ entry, rounds }),
    }
    this.ensureEvidenceWatches(record)
    for (const attempt of rounds.flatMap(round => round.evaluationAttempts ?? [])) {
      if (attempt.provider === 'hitch-cli' && EVAL_ID.test(attempt.evalId)) {
        this.ensureEvalWatch(attempt.evalId as HitchEvalId, record.id)
      }
    }
    return snapshot(record)
  }

  private roundEvaluationRefs(round: GearRound, fallbackBaselineId: RefinementCandidateId | null): RefinementEvaluationRef[] {
    const refs: RefinementEvaluationRef[] = []
    const seen = new Map<string, number>()
    const add = (
      evidence: GearEvaluationEvidence | undefined,
      owner: RefinementCandidateId | null,
      model: string,
      phase: GearEvaluationAttempt['phase'],
      failedEvaluation?: GearFailedEvaluation,
    ): void => {
      if (evidence === undefined || owner === null) return
      const attempts = (round.evaluationAttempts ?? []).filter(attempt => attempt.provider === evidence.provider && attempt.evalId === evidence.evalId)
      if (attempts.length > 1) throw new TypeError(`Gear eval attempt ownership is duplicated: ${evidence.evalId}`)
      const attempt = attempts[0]
      if (round.evaluationAttempts !== undefined && attempt === undefined) {
        throw new TypeError(`Gear final eval has no durable attempt ownership: ${evidence.evalId}`)
      }
      if (attempt !== undefined) {
        const evidenceCondition = 'conditionId' in evidence ? evidence.conditionId : undefined
        const repaired = attempt.status === 'repair-completed'
          && round.evaluationRepairResume?.provider === attempt.provider
          && round.evaluationRepairResume.evalId === attempt.evalId
          && round.evaluationRepairResume.completedAt === attempt.completedAt
        const finalEvidenceOwned = attempt.status === 'settled' || repaired
        const failedEvidenceOwned = attempt.status === 'failed' || attempt.status === 'cancelled'
          || attempt.status === 'rerunning'
        if (attempt.phase !== phase || candidateId(attempt.owner.candidateId) !== owner
          || attempt.dataset !== evidence.dataset || attempt.requestedCommit !== evidence.requestedCommit
          || attempt.owner.harnessRef !== evidence.actualCommit || attempt.requestedModelId !== model
          || (evidenceCondition !== undefined && attempt.conditionId !== evidenceCondition)
          || (failedEvaluation === undefined ? !finalEvidenceOwned : !failedEvidenceOwned)) {
          throw new TypeError(`Gear final eval conflicts with attempt ownership: ${evidence.evalId}`)
        }
      }
      const key = `${evidence.evalId}\u0000${owner}`
      const existing = seen.get(key)
      if (existing !== undefined) {
        if (failedEvaluation !== undefined) {
          const failedRef = this.evaluationRef(evidence, owner, model, failedEvaluation)
          if (failedRef !== null) refs[existing] = failedRef
        }
        return
      }
      const ref = this.evaluationRef(evidence, owner, model, failedEvaluation)
      if (ref === null) return
      seen.set(key, refs.length)
      refs.push(ref)
    }
    for (const parent of round.parentBaselines ?? []) {
      add(parent.evidence, candidateId(parent.parentCandidateId), round.plan.seed.model, 'seed-baseline')
    }
    add(round.baseline, fallbackBaselineId, round.plan.seed.model, 'seed-baseline')
    for (const candidate of round.candidatePool) {
      add(candidate.seedEvaluation, candidateId(candidate.candidateId), round.plan.seed.model, 'seed-candidate')
      add(candidate.heldOutEvaluation, candidateId(candidate.candidateId), round.plan.heldOut.model, 'held-out-candidate')
    }
    const promoted = round.promotionCandidateId ?? round.promotedCandidateId ?? round.candidatePool[0]?.candidateId
    add(round.evaluation?.seedBaseline, fallbackBaselineId, round.plan.seed.model, 'seed-baseline')
    add(round.evaluation?.seedCandidate, promoted === undefined ? null : candidateId(promoted), round.plan.seed.model, 'seed-candidate')
    add(round.evaluation?.heldOutBaseline, fallbackBaselineId, round.plan.heldOut.model, 'held-out-baseline')
    add(round.evaluation?.heldOutCandidate, promoted === undefined ? null : candidateId(promoted), round.plan.heldOut.model, 'held-out-candidate')
    for (const failed of round.failedEvaluations ?? []) {
      const attempt = (round.evaluationAttempts ?? []).find(value => value.provider === failed.evidence.provider
        && value.evalId === failed.evidence.evalId)
      if (attempt?.status === 'settled' || attempt?.status === 'repair-completed') continue
      const model = failed.phase.startsWith('seed-')
        ? round.plan.seed.model
        : round.plan.heldOut.model
      add(failed.evidence, candidateId(failed.owner.candidateId), model, failed.phase as GearEvaluationAttempt['phase'], failed)
    }
    for (const attempt of round.evaluationAttempts ?? []) {
      if (attempt.provider !== 'hitch-cli') continue
      const owner = candidateId(attempt.owner.candidateId)
      const key = `${attempt.evalId}\u0000${owner}`
      const existing = seen.get(key)
      if (existing !== undefined) {
        if (attempt.status === 'rerunning') {
          const current = refs[existing]
          if (current !== undefined) {
            const { failedEvaluation: _failedEvaluation, ...owned } = current
            refs[existing] = { ...owned, rerunning: true }
          }
        }
        continue
      }
      if (attempt.status === 'repair-completed') continue
      const ref = this.attemptEvaluationRef(attempt, owner)
      if (ref === null) continue
      seen.set(key, refs.length)
      refs.push(ref)
    }
    return refs
  }

  private validateEvaluationAttempts(round: GearRound): void {
    const identities = new Set<string>()
    for (const attempt of round.evaluationAttempts ?? []) {
      const identity = `${attempt.provider}\u0000${attempt.evalId}`
      if (identities.has(identity)) throw new TypeError(`Gear eval attempt is duplicated: ${attempt.evalId}`)
      identities.add(identity)
      if (attempt.provider === 'hitch-cli' && !EVAL_ID.test(attempt.evalId)) throw new TypeError(`Gear Hitch eval id is invalid: ${attempt.evalId}`)
      if (attempt.requestedCommit !== attempt.owner.harnessRef
        || attempt.owner.role !== (attempt.phase.endsWith('baseline') ? 'baseline' : 'candidate')) {
        throw new TypeError(`Gear eval attempt owner is invalid: ${attempt.evalId}`)
      }
      const condition = attempt.phase.startsWith('seed-') ? round.plan.seed : round.plan.heldOut
      const dataset = attempt.phase.startsWith('seed-') ? round.seedTaskRef : round.heldOutRef
      if (attempt.requestedModelId !== condition.model
        || (condition.conditionId !== undefined && attempt.conditionId !== condition.conditionId)
        || (dataset !== undefined && attempt.dataset !== dataset)) {
        throw new TypeError(`Gear eval attempt condition is invalid: ${attempt.evalId}`)
      }
      const active = attempt.status === 'running' || attempt.status === 'rerunning'
      const terminal = !active
      if (terminal !== (attempt.completedAt !== undefined)
        || (active && attempt.failure !== undefined)
        || ((attempt.status === 'failed' || attempt.status === 'cancelled') && attempt.failure === undefined)
        || ((attempt.status === 'settled' || attempt.status === 'repair-completed') && attempt.failure !== undefined)
        || (attempt.reusedFromRoundId !== undefined
          && (attempt.reusedFromRoundId === round.roundId || !attempt.phase.endsWith('baseline')
            || attempt.status !== 'settled'))) {
        throw new TypeError(`Gear eval attempt lifecycle is invalid: ${attempt.evalId}`)
      }
      if (attempt.status === 'repair-completed') {
        const resume = round.evaluationRepairResume
        if (resume?.provider !== attempt.provider || resume.evalId !== attempt.evalId
          || resume.completedAt !== attempt.completedAt) {
          throw new TypeError(`Gear completed eval repair has no durable resume intent: ${attempt.evalId}`)
        }
      }
      timestamp(attempt.startedAt)
      if (attempt.completedAt !== undefined) timestamp(attempt.completedAt)
      if (attempt.owner.role === 'candidate') {
        const candidate = round.candidatePool.find(value => value.candidateId === attempt.owner.candidateId)
        if (candidate?.sealedVersion?.commitOid !== attempt.owner.harnessRef) {
          throw new TypeError(`Gear eval attempt candidate owner is invalid: ${attempt.evalId}`)
        }
      } else {
        const allocation = round.parentAllocations?.find(value => value.parentCandidateId === attempt.owner.candidateId
          && value.parentHarnessRef === attempt.owner.harnessRef)
        const champion = attempt.owner.candidateId === `champion-${round.targetHarnessRef}`
          && attempt.owner.harnessRef === round.targetHarnessRef
        if (allocation === undefined && !champion) throw new TypeError(`Gear eval attempt baseline owner is invalid: ${attempt.evalId}`)
      }
    }
  }

  private attemptEvaluationRef(
    attempt: GearEvaluationAttempt,
    owner: RefinementCandidateId,
  ): RefinementEvaluationRef | null {
    const identity = this.hitchEvalIdentityForEval(attempt.evalId)
    if (identity === null) return null
    return {
      providerId: this.provider.id,
      evalId: attempt.evalId as HitchEvalId,
      candidateId: owner,
      requestedModelId: attempt.requestedModelId,
      conditionId: attempt.conditionId,
      benchmarkId: identity.benchmarkId,
      benchmarkRevision: identity.benchmarkRevision,
      ...(attempt.status === 'rerunning' ? { rerunning: true as const } : {}),
      ...((attempt.status !== 'failed' && attempt.status !== 'cancelled') ? {} : {
        failedEvaluation: {
          phase: attempt.phase,
          code: attempt.failure?.code ?? attempt.status,
          message: attempt.failure?.message ?? `Gear evaluation ${attempt.status}`,
        },
      }),
    }
  }

  /** Convert a Gear eval only after its exact run membership agrees with Hitch. */
  private evaluationRef(
    evidence: GearEvaluationEvidence,
    owner: RefinementCandidateId,
    requestedModelId: string,
    failedEvaluation?: GearFailedEvaluation,
  ): RefinementEvaluationRef | null {
    if (!EVAL_ID.test(evidence.evalId)) throw new TypeError(`Gear eval id is invalid: ${evidence.evalId}`)
    const gearTrials = [
      ...evidence.trials,
      ...(Array.isArray(evidence['invalidTrials']) ? gearEvidenceSchema.shape.invalidTrials.parse(evidence['invalidTrials']) : []),
    ].filter(trial => trial.runId !== undefined)
    if (failedEvaluation !== undefined && failedEvaluation.evidence.runSetComplete !== true) {
      throw new TypeError(`Gear failed eval run set is incomplete: ${evidence.evalId}`)
    }
    if (gearTrials.length === 0 && failedEvaluation === undefined) return null
    for (const trial of gearTrials) {
      if (trial.runId === undefined || !RUN_ID.test(trial.runId)) throw new TypeError(`Gear run id is invalid: ${String(trial.runId)}`)
    }
    if (new Set(gearTrials.map(trial => trial.runId)).size !== gearTrials.length) {
      throw new TypeError(`Gear eval run ids are duplicated: ${evidence.evalId}`)
    }
    const identity = this.hitchEvalIdentity(evidence, gearTrials)
    return {
      providerId: this.provider.id,
      evalId: evidence.evalId as HitchEvalId,
      candidateId: owner,
      requestedModelId,
      conditionId: evidence.conditionId,
      benchmarkId: identity.benchmarkId,
      benchmarkRevision: identity.benchmarkRevision,
      ...(failedEvaluation === undefined ? {} : {
        failedEvaluation: {
          phase: failedEvaluation.phase,
          code: failedEvaluation.failure.code,
          message: failedEvaluation.failure.message,
        },
      }),
    }
  }

  private hitchEvalIdentity(evidence: GearEvaluationEvidence, gearTrials: readonly GearTrial[]): HitchEvalIdentity {
    const path = join(this.provider.rootPath, 'evals', evidence.evalId, 'result.json')
    const value = regularJson(path, this.provider.rootPath, `Hitch eval ${evidence.evalId}`)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Hitch eval result is not an object')
    const result = value as Record<string, unknown>
    if (result['schema_version'] !== '1' || result['eval_id'] !== evidence.evalId) {
      throw new TypeError(`Gear/Hitch eval identity mismatch: ${evidence.evalId}`)
    }
    const benchmarkId = result['benchmark_id']
    const benchmarkRevision = result['benchmark_revision']
    if (typeof benchmarkId !== 'string' || benchmarkId.length === 0
      || typeof benchmarkRevision !== 'string' || benchmarkRevision.length === 0) {
      throw new TypeError(`Hitch eval ${evidence.evalId} has no canonical benchmark identity`)
    }
    if (!Array.isArray(result['trials'])) throw new TypeError(`Hitch eval ${evidence.evalId} has no trials`)
    const trials = result['trials'].map((trial, index) => {
      if (typeof trial !== 'object' || trial === null || Array.isArray(trial)) {
        throw new TypeError(`Hitch eval ${evidence.evalId} trial ${index} is invalid`)
      }
      const value = trial as Record<string, unknown>
      if (typeof value['run_id'] !== 'string' || !RUN_ID.test(value['run_id'])) {
        throw new TypeError(`Hitch eval ${evidence.evalId} trial ${index} run id is invalid`)
      }
      return value
    })
    const gearRunIds = new Set(gearTrials.map(trial => trial.runId))
    const hitchRunIds = new Set(trials.map(trial => trial['run_id']))
    if (hitchRunIds.size !== trials.length
      || gearRunIds.size !== hitchRunIds.size
      || [...gearRunIds].some(runId => !hitchRunIds.has(runId))) {
      throw new TypeError(`Gear/Hitch run membership mismatch for eval ${evidence.evalId}`)
    }
    for (const gearTrial of gearTrials) {
      const hitchTrial = trials.find(trial => trial['run_id'] === gearTrial.runId)
      if (hitchTrial === undefined) throw new TypeError(`Gear run ${String(gearTrial.runId)} is absent from Hitch eval ${evidence.evalId}`)
      if (gearTrial.trialName !== undefined && hitchTrial['trial_id'] !== gearTrial.trialName) {
        throw new TypeError(`Gear/Hitch trial identity mismatch for run ${String(gearTrial.runId)}`)
      }
      if (hitchTrial['task_id'] !== gearTrial.taskName) {
        throw new TypeError(`Gear/Hitch task identity mismatch for run ${String(gearTrial.runId)}`)
      }
      if (gearTrial.attempt !== undefined && hitchTrial['attempt'] !== gearTrial.attempt) {
        throw new TypeError(`Gear/Hitch attempt identity mismatch for run ${String(gearTrial.runId)}`)
      }
    }
    return { benchmarkId, benchmarkRevision }
  }

  private hitchEvalIdentityForEval(evalId: string): HitchEvalIdentity | null {
    const directory = join(this.provider.rootPath, 'evals', evalId)
    if (!existsSync(directory)) return null
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError(`Hitch eval directory is invalid: ${evalId}`)
    const identities: HitchEvalIdentity[] = []
    for (const name of ['request.json', 'progress.json', 'result.json']) {
      const path = join(directory, name)
      if (!existsSync(path)) continue
      const value = regularJson(path, this.provider.rootPath, `Hitch eval ${evalId} ${name}`)
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`Hitch eval ${evalId} ${name} is not an object`)
      }
      const record = value as Record<string, unknown>
      if ((name === 'progress.json' || name === 'result.json')
        && (record['schema_version'] !== '1' || record['eval_id'] !== evalId)) {
        throw new TypeError(`Hitch eval ${evalId} ${name} identity mismatch`)
      }
      const benchmarkId = record['benchmark_id']
      const benchmarkRevision = record['benchmark_revision']
      if (typeof benchmarkId !== 'string' || benchmarkId.length === 0
        || typeof benchmarkRevision !== 'string' || benchmarkRevision.length === 0) {
        throw new TypeError(`Hitch eval ${evalId} ${name} has no canonical benchmark identity`)
      }
      identities.push({ benchmarkId, benchmarkRevision })
    }
    if (identities.length === 0) return null
    const first = identities[0]!
    if (identities.some(identity => identity.benchmarkId !== first.benchmarkId
      || identity.benchmarkRevision !== first.benchmarkRevision)) {
      throw new TypeError(`Hitch eval ${evalId} benchmark identity changed across artifacts`)
    }
    return first
  }

  private ownedRecord(request: RefinementGetRequest): RefinementGetResult {
    const header = this.sessions().get(request.sessionId)?.header
    if (header === undefined) return rejected('refinement-not-found', 'Refine view Session was not found')
    const id = evolutionId(request.refinementId)
    if (id === null) return rejected('refinement-not-found', 'Gear evolution was not found')
    const entry = this.readRegistry().find(value => value.evolutionId === id)
    if (entry === undefined) return rejected('refinement-not-found', 'Gear evolution was not found')
    return success(this.project(entry, header))
  }

  private iterationSelection(request: RefinementEvaluationRequest): InternalResult<readonly RefinementEvaluationRef[]> {
    const owned = this.ownedRecord(request)
    if (!owned.ok) return owned
    const iteration = owned.value.iterations.find(value => value.id === request.iterationId)
    if (iteration === undefined) return rejected('refinement-not-found', 'Gear round was not found')
    return { ok: true, value: iteration.evaluationRefs }
  }

  private async runLookup(request: RefinementTrajectoryRequest): Promise<InternalResult<RefinementEvaluationRef>> {
    const owned = this.ownedRecord(request)
    if (!owned.ok) return owned
    for (const ref of owned.value.iterations.flatMap(iteration => iteration.evaluationRefs)) {
      const projection = await this.provider.evaluation(ref)
      if (projection.runs.some(run => run.id === request.runId)) return { ok: true, value: ref }
    }
    return rejected('run-not-found', `run "${request.runId}" is not owned by this Gear evolution`)
  }

  private providerFailure(error: unknown): RefinementRejected {
    if (error instanceof RefinementProviderError) return rejected(error.code, error.message)
    throw error
  }

  private ensureEvidenceWatches(record: RefinementRecordV1): void {
    for (const ref of record.iterations.flatMap(iteration => iteration.evaluationRefs)) {
      this.ensureEvalWatch(ref.evalId, record.id)
    }
  }

  private ensureEvalWatch(evalId: HitchEvalId, refinement: RefinementId): void {
    const key = String(evalId)
    const current = this.evidenceWatches.get(key)
    if (current !== undefined) {
      current.ids.add(refinement)
      return
    }
    const ids = new Set<RefinementId>([refinement])
    const dispose = this.provider.watchEval(evalId, () => {
      for (const id of ids) this.emitChange(id)
    })
    this.evidenceWatches.set(key, { ids, dispose })
  }

  private queueGearChange(): void {
    if (this.gearTimer !== undefined) clearTimeout(this.gearTimer)
    this.gearTimer = setTimeout(() => {
      this.gearTimer = undefined
      try {
        for (const entry of this.readRegistry()) this.emitChange(refinementId(entry.evolutionId))
      } catch (error) {
        this.ctx.logger.warn(`refinement-gear: failed to rescan state: ${String(error)}`)
      }
    }, this.gearWatchDebounceMs)
  }

  private emitChange(id: RefinementId): void {
    for (const session of this.sessions().list()) {
      try {
        this.ctx.emit('refinement/change', session.id, id, randomUUID() as RefinementChangeToken)
      } catch (error) {
        this.ctx.logger.warn(`refinement "${id}": change listener failed: ${String(error)}`)
      }
    }
  }

  /** Avoid the Host/Client `Context.sessions` declaration collision in this dual-face package. */
  private sessions(): SessionStore {
    return this.ctx.get('sessions') as SessionStore
  }
}

export default RefinementRuntime
