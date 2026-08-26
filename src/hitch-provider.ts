/** Read-only Hitch run-centered evidence provider. @module dsh-plugin-rear/hitch-provider */

import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, readFileSync, realpathSync, watch,
} from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import s from '@deepseek-ai/schemastery'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type {
  CanonicalTrajectoryDocument,
  CanonicalTrajectoryEvent,
  HitchEvalId,
  HitchRunId,
  RefinementComparisonExclusion,
  RefinementEvaluationProjection,
  RefinementEvaluationRef,
  RefinementFailure,
  RefinementProviderEvidencePage,
  RefinementRunView,
  RefinementStrictComparisonResult,
  RefinementTaskComparison,
} from './types.ts'
import {
  RefinementProviderError,
} from './providers.ts'
import type {
  RefinementComparisonRequest,
  RefinementEvidenceProvider,
  RefinementProviderEvidenceLookup,
  RefinementTrajectoryLookup,
} from './providers.ts'

/** Cordis plugin name. */
export const name = 'refinement-hitch'
/** The provider registry must exist before registration. */
export const inject = ['refinements']

/** Explicit Hitch installation and watch policy. */
export interface Config {
  /** Registry identity selected by the refinement runtime. */
  readonly id: string
  /** Absolute Hitch state root containing run-centered `evals/` and `runs/`. */
  readonly root: string
  /** Filesystem invalidation debounce interval in milliseconds. */
  readonly watchDebounceMs: number
}

/** Loader schema with no machine-specific path fallback. */
export const Config: s<Config> = s.object({
  id: s.string().required(),
  root: s.string().required(),
  watchDebounceMs: s.number().step(1).min(1).required(),
})

type JsonRecord = Record<string, unknown>

interface EvalTrial {
  readonly trialId: string
  readonly runId: HitchRunId
  readonly taskId: string
  readonly attempt: number
  readonly observationStatus: 'valid' | 'invalid'
  readonly reward?: number
  readonly invalidReason?: string
}

interface EvalResult {
  readonly evalId: HitchEvalId
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  readonly status: 'succeeded' | 'failed' | 'cancelled'
  readonly trials: readonly EvalTrial[]
}

interface TrajectoryFile {
  readonly role: string
  readonly path: string
  readonly mediaType: string
  readonly sha256: string
  readonly bytes: number
}

interface TrajectoryDescriptor {
  readonly availability: RefinementRunView['trajectory']['availability']
  readonly files: readonly TrajectoryFile[]
  readonly canonical: TrajectoryFile | null
  readonly providers: readonly TrajectoryFile[]
  readonly summary?: RefinementRunView['trajectory']['summary']
}

interface LoadedRun {
  readonly directory: string
  readonly manifest: JsonRecord
  readonly view: RefinementRunView
  readonly trajectory: TrajectoryDescriptor
}

const RUN_ID = /^run_[a-f0-9]{32}$/u
const EVAL_ID = /^eval_[A-Za-z0-9._-]+$/u
const SHA256 = /^sha256:[a-f0-9]{64}$/u
const TERMINAL = new Set(['succeeded', 'failed', 'timed_out', 'cancelled'])

/** Require a plain JSON object. */
function object(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`)
  }
  return value as JsonRecord
}

/** Require a non-empty string. */
function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

/** Require a positive safe integer. */
function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
  return value
}

/** Validate a non-negative safe integer. */
function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
  return value
}

/** Require a finite number. */
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
  return value
}

/** Canonical JSON used only for identity comparison. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as JsonRecord)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Read a regular non-symlink file. */
function regular(path: string): Buffer {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new TypeError('Hitch evidence must be a regular file')
  return readFileSync(path)
}

/** Parse one regular JSON file. */
function json(path: string, label: string): unknown {
  try {
    return JSON.parse(regular(path).toString('utf8'))
  } catch (error) {
    throw new TypeError(`${label} is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Resolve a normalized relative evidence reference inside one real run directory. */
function evidencePath(runDirectory: string, ref: string): string {
  if (ref.includes('\\') || ref.startsWith('/')
    || ref.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError('Hitch evidence path must be a normalized relative path')
  }
  const target = resolve(runDirectory, ...ref.split('/'))
  const realRun = realpathSync(runDirectory)
  const realTarget = realpathSync(target)
  const fromRun = relative(realRun, realTarget)
  if (!fromRun || fromRun.startsWith('..') || isAbsolute(fromRun)) {
    throw new TypeError('Hitch evidence path escapes its run directory')
  }
  return realTarget
}

/** Verify declared bytes and SHA-256 before returning file content. */
function verifiedFile(runDirectory: string, file: TrajectoryFile): Buffer {
  const bytes = regular(evidencePath(runDirectory, file.path))
  if (bytes.length !== file.bytes) throw new TypeError(`Hitch evidence size mismatch (${file.path})`)
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  if (digest !== file.sha256) throw new TypeError(`Hitch evidence checksum mismatch (${file.path})`)
  return bytes
}

/** Parse one TrajectoryRef V2 file descriptor. */
function trajectoryFile(value: unknown, index: number): TrajectoryFile {
  const record = object(value, `trajectory file ${index}`)
  const digest = string(record['sha256'], `trajectory file ${index} sha256`)
  if (!SHA256.test(digest)) throw new TypeError(`trajectory file ${index} sha256 is invalid`)
  const bytes = nonNegativeInteger(record['bytes'], `trajectory file ${index} bytes`)
  return {
    role: string(record['role'], `trajectory file ${index} role`),
    path: string(record['path'], `trajectory file ${index} path`),
    mediaType: string(record['media_type'], `trajectory file ${index} media_type`),
    sha256: digest,
    bytes,
  }
}

/** Read canonical NDJSON and derive only lightweight recorded facts. */
function canonicalLines(bytes: Buffer): { header: SessionHeader; events: CanonicalTrajectoryEvent[] } {
  const rows = bytes.toString('utf8').split(/\r?\n/u).filter(line => line.trim() !== '').map((line, index) => {
    try {
      return object(JSON.parse(line), `canonical line ${index + 1}`)
    } catch (error) {
      throw new TypeError(`canonical line ${index + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  const header = rows.shift()
  if (header === undefined || header['type'] !== 'session' || header['version'] !== 0) {
    throw new TypeError('canonical trajectory requires a DSH Session v0 header')
  }
  string(header['id'], 'canonical session id')
  if (typeof header['createdAt'] !== 'number' || !Number.isSafeInteger(header['createdAt']) || header['createdAt'] < 0) {
    throw new TypeError('canonical session createdAt is invalid')
  }
  rows.forEach((event, index) => {
    if (event['seq'] !== index || typeof event['type'] !== 'string'
      || typeof event['time'] !== 'number' || !Number.isSafeInteger(event['time'])
      || !('data' in event)) {
      throw new TypeError(`canonical event ${index} has an invalid envelope or non-contiguous seq`)
    }
  })
  return { header: header as unknown as SessionHeader, events: rows as unknown as CanonicalTrajectoryEvent[] }
}

/** Derive a light trajectory summary from recorded events without current-time inference. */
function trajectorySummary(bytes: Buffer): RefinementRunView['trajectory']['summary'] {
  const { events } = canonicalLines(bytes)
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let firstStep: number | undefined
  let firstToken: number | undefined
  for (const event of events) {
    if (event.type === 'step/start' && firstStep === undefined) firstStep = event.time
    if (event.type === 'assistant/chunk' && firstToken === undefined) firstToken = event.time
    if (event.type !== 'assistant/message') continue
    const usage = object(event.data, 'assistant message data')['usage']
    if (usage === undefined) continue
    const value = object(usage, 'assistant usage')
    if (typeof value['inputTokens'] === 'number') inputTokens = (inputTokens ?? 0) + value['inputTokens']
    if (typeof value['outputTokens'] === 'number') outputTokens = (outputTokens ?? 0) + value['outputTokens']
  }
  return {
    turnCount: events.filter(event => event.type === 'turn/start').length,
    toolCalls: events.filter(event => event.type === 'tool/call').length,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(firstStep === undefined || firstToken === undefined ? {} : { ttftMs: Math.max(0, firstToken - firstStep) }),
  }
}

/** Validate a run's complete TrajectoryRef V2 projection. */
function loadTrajectory(runDirectory: string, runId: HitchRunId, refValue: unknown, terminal: boolean): TrajectoryDescriptor {
  if (refValue === undefined) {
    return { availability: terminal ? 'missing' : 'pending', files: [], canonical: null, providers: [] }
  }
  try {
    const refPath = evidencePath(runDirectory, string(refValue, 'trajectory_ref'))
    const ref = object(json(refPath, 'trajectory ref'), 'trajectory ref')
    if (ref['schema_version'] !== '2') {
      return { availability: 'unsupported', files: [], canonical: null, providers: [] }
    }
    if (ref['run_id'] !== runId) throw new TypeError('trajectory ref run_id mismatch')
    if (!Array.isArray(ref['files'])) throw new TypeError('trajectory ref files must be an array')
    const files = ref['files'].map(trajectoryFile)
    const canonical = files.find(file => file.role === 'canonical_session') ?? null
    const providers = files.filter(file => file.role !== 'canonical_session')
    let summary: RefinementRunView['trajectory']['summary'] | undefined
    for (const file of files) {
      const bytes = verifiedFile(runDirectory, file)
      if (file.role === 'canonical_session') summary = trajectorySummary(bytes)
    }
    return {
      availability: canonical === null ? (providers.length > 0 ? 'provider-only' : 'missing') : 'available',
      files,
      canonical,
      providers,
      ...(summary === undefined ? {} : { summary }),
    }
  } catch {
    return { availability: 'corrupt', files: [], canonical: null, providers: [] }
  }
}

/** Parse one immutable eval result. */
function parseEval(value: unknown, expected: RefinementEvaluationRef): EvalResult {
  const record = object(value, 'Hitch eval result')
  if (record['schema_version'] !== '1') throw new TypeError('unsupported Hitch eval result schema')
  if (record['eval_id'] !== expected.evalId) throw new TypeError('Hitch eval identity mismatch')
  if (record['benchmark_id'] !== expected.benchmarkId || record['benchmark_revision'] !== expected.benchmarkRevision) {
    throw new TypeError('Hitch eval benchmark identity mismatch')
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(String(record['status']))) {
    throw new TypeError('Hitch eval status is invalid')
  }
  if (!Array.isArray(record['trials'])) throw new TypeError('Hitch eval trials must be an array')
  const trials = record['trials'].map((value, index): EvalTrial => {
    const trial = object(value, `Hitch eval trial ${index}`)
    const runId = string(trial['run_id'], `Hitch eval trial ${index} run_id`)
    if (!RUN_ID.test(runId)) throw new TypeError(`Hitch eval trial ${index} run_id is invalid`)
    const status = trial['observation_status']
    if (status !== 'valid' && status !== 'invalid') throw new TypeError(`Hitch eval trial ${index} observation is invalid`)
    return {
      trialId: string(trial['trial_id'], `Hitch eval trial ${index} trial_id`),
      runId: runId as HitchRunId,
      taskId: string(trial['task_id'], `Hitch eval trial ${index} task_id`),
      attempt: positiveInteger(trial['attempt'], `Hitch eval trial ${index} attempt`),
      observationStatus: status,
      ...(status === 'valid' ? { reward: finite(trial['reward'], `Hitch eval trial ${index} reward`) } : {
        invalidReason: string(trial['invalid_reason'], `Hitch eval trial ${index} invalid_reason`),
      }),
    }
  })
  if (new Set(trials.map(trial => trial.runId)).size !== trials.length) {
    throw new TypeError('Hitch eval run ids must be unique')
  }
  return {
    evalId: expected.evalId,
    benchmarkId: expected.benchmarkId,
    benchmarkRevision: expected.benchmarkRevision,
    status: record['status'] as EvalResult['status'],
    trials,
  }
}

/** Normalize a millisecond or ISO timestamp when recorded. */
function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Load and cross-check one run referenced by an eval trial. */
function loadRun(root: string, ref: RefinementEvaluationRef, trial: EvalTrial): LoadedRun {
  const directory = join(root, 'runs', trial.runId)
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || basename(realpathSync(directory)) !== trial.runId) {
    throw new TypeError('Hitch run directory is invalid')
  }
  const manifest = object(json(join(directory, 'manifest.json'), 'Hitch run manifest'), 'Hitch run manifest')
  if (manifest['schema_version'] !== '1' || manifest['run_id'] !== trial.runId) throw new TypeError('Hitch run identity mismatch')
  const context = object(manifest['context'], 'Hitch run context')
  const parent = object(manifest['parent'], 'Hitch run parent')
  if (context['kind'] !== 'benchmark_task'
    || context['benchmark_id'] !== ref.benchmarkId
    || context['benchmark_revision'] !== ref.benchmarkRevision
    || context['task_id'] !== trial.taskId
    || parent['kind'] !== 'eval'
    || parent['eval_id'] !== ref.evalId
    || parent['trial_id'] !== trial.trialId
    || parent['attempt'] !== trial.attempt) {
    throw new TypeError('Hitch eval/run ownership mismatch')
  }
  const execution = string(manifest['status'], 'Hitch run status')
  if (!['queued', 'preparing', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'].includes(execution)) {
    throw new TypeError('Hitch run status is invalid')
  }
  const observation = manifest['observation'] === undefined ? undefined : object(manifest['observation'], 'Hitch run observation')
  if (trial.observationStatus === 'valid'
    && (observation?.['status'] !== 'valid' || observation['reward'] !== trial.reward)) {
    throw new TypeError('Hitch run valid observation differs from eval trial')
  }
  if (trial.observationStatus === 'invalid'
    && (observation?.['status'] !== 'invalid' || observation['invalid_reason'] !== trial.invalidReason)) {
    throw new TypeError('Hitch run invalid observation differs from eval trial')
  }
  const harness = object(manifest['harness'], 'Hitch run harness')
  const model = object(manifest['model'], 'Hitch run model')
  const protocol = object(manifest['protocol'], 'Hitch run protocol')
  const trajectory = loadTrajectory(directory, trial.runId, manifest['trajectory_ref'], TERMINAL.has(execution))
  const trajectoryCorrupt = trajectory.availability === 'corrupt'
  const startedAt = timestamp(manifest['created_at'])
  const completedAt = timestamp(manifest['completed_at'])
  const taskKey = canonicalJson({
    benchmarkId: context['benchmark_id'],
    benchmarkRevision: context['benchmark_revision'],
    taskId: context['task_id'],
    taskDigest: context['task_digest'],
    verifierIdentity: context['verifier_identity'],
  })
  const view: RefinementRunView = {
    id: trial.runId,
    evalId: ref.evalId,
    candidateId: ref.candidateId,
    trialId: trial.trialId,
    attempt: trial.attempt,
    taskKey,
    taskId: trial.taskId,
    execution: execution === 'timed_out' ? 'timed-out' : execution as RefinementRunView['execution'],
    observation: observation === undefined
      ? { state: 'pending' }
      : observation['status'] === 'valid'
        ? { state: 'valid', reward: finite(observation['reward'], 'Hitch run reward') }
        : { state: 'invalid', reason: string(observation['invalid_reason'], 'Hitch invalid reason') },
    integrity: trajectoryCorrupt ? 'corrupt' : TERMINAL.has(execution) ? 'valid' : 'pending',
    harness: {
      requestedRef: string(harness['requested_ref'], 'Hitch requested harness ref'),
      id: string(harness['harness_id'], 'Hitch harness id'),
      revisionIdentity: harness['revision_identity'] === null ? null : string(harness['revision_identity'], 'Hitch harness revision'),
    },
    model: {
      requestedId: string(model['requested_id'], 'Hitch requested model id'),
      provider: typeof model['provider'] === 'string' ? model['provider'] : null,
      effectiveId: model['identity_resolved'] === true && typeof model['effective_id'] === 'string' ? model['effective_id'] : null,
    },
    protocolIdentity: canonicalJson(protocol),
    trajectory: {
      availability: trajectory.availability,
      hasCanonical: trajectory.canonical !== null,
      providerFileCount: trajectory.providers.length,
      ...(trajectory.summary === undefined ? {} : { summary: trajectory.summary }),
    },
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  }
  return { directory, manifest, view, trajectory }
}

/** Mean over valid, complete observations only. */
function mean(runs: readonly RefinementRunView[]): number | null {
  const values = runs.flatMap(run => run.integrity === 'valid' && run.observation.state === 'valid'
    ? [run.observation.reward]
    : [])
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Deterministic table status from two task cells. */
function taskStatus(
  reference: readonly RefinementRunView[],
  candidate: readonly RefinementRunView[],
  referenceMean: number | null,
  candidateMean: number | null,
): RefinementTaskComparison['status'] {
  if ([...reference, ...candidate].some(run => !TERMINAL.has(run.execution === 'timed-out' ? 'timed_out' : run.execution))) {
    return 'pending'
  }
  if (referenceMean === null || candidateMean === null) return 'invalid'
  if (candidateMean < referenceMean) return 'regressed'
  if (candidateMean > referenceMean) return 'improved'
  return 'unchanged'
}

/** Move a requested text page end back to a complete UTF-8 code-point boundary. */
function utf8PageEnd(bytes: Buffer, offset: number, requestedEnd: number): number {
  let end = requestedEnd
  while (end > offset && end < bytes.length && ((bytes[end] as number) & 0xc0) === 0x80) end -= 1
  return end
}

/** Host-only provider implementation over the documented run-centered layout. */
export class HitchRefinementEvidenceProvider implements RefinementEvidenceProvider {
  readonly id: string
  private readonly root: string
  private readonly watchDebounceMs: number

  /** @param config - explicit Hitch state root and provider identity. */
  constructor(config: Config) {
    if (config.id.trim() === '') throw new TypeError('refinement-hitch: id must be non-empty')
    if (!isAbsolute(config.root)) throw new TypeError('refinement-hitch: root must be absolute')
    if (!Number.isSafeInteger(config.watchDebounceMs) || config.watchDebounceMs < 1) {
      throw new TypeError('refinement-hitch: watchDebounceMs must be a positive safe integer')
    }
    this.id = config.id.trim()
    this.root = resolve(config.root)
    this.watchDebounceMs = config.watchDebounceMs
  }

  /** Canonical real root used by trusted Host adapters to validate eval ownership. */
  get rootPath(): string { return this.root }

  /** @returns whether the configured root is a real directory. */
  available(): boolean {
    try {
      const info = lstatSync(this.root)
      return info.isDirectory() && !info.isSymbolicLink()
    } catch {
      return false
    }
  }

  /** Read one exact evaluation and retain every attempt. */
  // oxlint-disable-next-line typescript/require-await -- the provider interface is uniformly asynchronous.
  async evaluation(ref: RefinementEvaluationRef): Promise<RefinementEvaluationProjection> {
    this.assertRef(ref)
    const directory = join(this.root, 'evals', ref.evalId)
    if (!existsSync(directory)) throw new RefinementProviderError('evaluation-not-found', `Hitch eval "${ref.evalId}" was not found`)
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Hitch eval directory is invalid')
    const resultPath = join(directory, 'result.json')
    if (!existsSync(resultPath)) {
      return {
        ref,
        status: 'running',
        plannedTasks: this.plannedTasks(directory),
        settledTasks: 0,
        runs: [],
        diagnostics: [],
      }
    }
    let result: EvalResult
    try {
      result = parseEval(json(resultPath, 'Hitch eval result'), ref)
    } catch (error) {
      return {
        ref,
        status: 'corrupt',
        plannedTasks: null,
        settledTasks: 0,
        runs: [],
        diagnostics: [{ code: 'corrupt-eval', message: error instanceof Error ? error.message : String(error) }],
      }
    }
    const runs: RefinementRunView[] = []
    const diagnostics: RefinementFailure[] = []
    for (const trial of result.trials) {
      try {
        runs.push(loadRun(this.root, ref, trial).view)
      } catch (error) {
        diagnostics.push({ code: 'corrupt-run-link', message: `${trial.runId}: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    return {
      ref,
      status: result.status,
      plannedTasks: new Set(result.trials.map(trial => trial.taskId)).size,
      settledTasks: new Set(result.trials.map(trial => trial.taskId)).size,
      runs,
      diagnostics,
    }
  }

  /** Compare the first and latest candidate refs without hiding invalid attempts. */
  async compare(request: RefinementComparisonRequest): Promise<RefinementStrictComparisonResult> {
    const projections = await Promise.all(request.refs.map(ref => this.evaluation(ref)))
    const runs = projections.flatMap(projection => projection.runs)
    const candidateIds = [...new Set(request.refs.map(ref => ref.candidateId))]
    const referenceCandidate = candidateIds[0]
    const targetCandidate = candidateIds.at(-1)
    const referenceRun = request.referenceRunId === null
      ? runs.find(run => run.candidateId === referenceCandidate)
      : runs.find(run => run.id === request.referenceRunId && run.candidateId === referenceCandidate)
    const exclusions: RefinementComparisonExclusion[] = []
    const taskKeys = [...new Set(runs.map(run => run.taskKey))]
    let identityCompatible = request.refs.every(ref => ref.failedEvaluation === undefined)
      && referenceRun !== undefined
      && referenceCandidate !== targetCandidate
    for (const run of runs) {
      if (referenceRun === undefined) {
        exclusions.push({ runId: run.id, code: 'benchmark-reference-missing' })
        continue
      }
      if (run.taskKey !== referenceRun.taskKey && run.taskId === referenceRun.taskId) {
        exclusions.push({ runId: run.id, code: 'task-identity-mismatch' })
        identityCompatible = false
      }
      if (run.protocolIdentity !== referenceRun.protocolIdentity) {
        exclusions.push({ runId: run.id, code: 'protocol-identity-mismatch' })
        identityCompatible = false
      }
      if (request.dimension === 'harness') {
        if (run.model.effectiveId === null || referenceRun.model.effectiveId === null) {
          exclusions.push({ runId: run.id, code: 'model-identity-unresolved' })
          identityCompatible = false
        } else if (run.model.provider !== referenceRun.model.provider || run.model.effectiveId !== referenceRun.model.effectiveId) {
          exclusions.push({ runId: run.id, code: 'model-identity-mismatch' })
          identityCompatible = false
        }
      } else if (run.harness.revisionIdentity === null || referenceRun.harness.revisionIdentity === null) {
        exclusions.push({ runId: run.id, code: 'harness-identity-unresolved' })
        identityCompatible = false
      } else if (run.harness.id !== referenceRun.harness.id || run.harness.revisionIdentity !== referenceRun.harness.revisionIdentity) {
        exclusions.push({ runId: run.id, code: 'harness-identity-mismatch' })
        identityCompatible = false
      }
    }
    const dimensionValues = new Set(runs.map(run => request.dimension === 'harness'
      ? `${run.harness.id}\u0000${run.harness.revisionIdentity ?? ''}`
      : `${run.model.provider ?? ''}\u0000${run.model.effectiveId ?? ''}`))
    if (dimensionValues.size < 2) identityCompatible = false
    const tasks: RefinementTaskComparison[] = taskKeys.map((taskKey) => {
      const taskRuns = runs.filter(run => run.taskKey === taskKey)
      const reference = taskRuns.filter(run => run.candidateId === referenceCandidate)
      const candidate = taskRuns.filter(run => run.candidateId === targetCandidate)
      if (reference.length === 0 || candidate.length === 0) {
        identityCompatible = false
        for (const run of taskRuns) {
          if (!exclusions.some(item => item.runId === run.id && item.code === 'benchmark-reference-missing')) {
            exclusions.push({ runId: run.id, code: 'benchmark-reference-missing' })
          }
        }
      }
      const referenceMean = mean(reference)
      const candidateMean = mean(candidate)
      return {
        taskKey,
        taskId: taskRuns[0]?.taskId ?? 'unknown',
        referenceRunIds: reference.map(run => run.id),
        candidateRunIds: candidate.map(run => run.id),
        referenceMean,
        candidateMean,
        delta: referenceMean === null || candidateMean === null ? null : candidateMean - referenceMean,
        status: taskStatus(reference, candidate, referenceMean, candidateMean),
      }
    }).sort((left, right) => {
      const order = ['regressed', 'invalid', 'improved', 'unchanged', 'pending']
      return order.indexOf(left.status) - order.indexOf(right.status) || left.taskId.localeCompare(right.taskId)
    })
    return {
      strict: identityCompatible,
      dimension: request.dimension,
      referenceRunId: referenceRun?.id ?? null,
      exclusions,
      tasks,
    }
  }

  /** Load one checksum-validated normalized Session document. */
  async trajectory(request: RefinementTrajectoryLookup): Promise<CanonicalTrajectoryDocument> {
    const loaded = await this.ownedRun(request.evalRef, request.runId)
    const file = loaded.trajectory.canonical
    if (loaded.trajectory.availability === 'corrupt') {
      throw new RefinementProviderError('trajectory-corrupt', `trajectory for run "${request.runId}" is corrupt`)
    }
    if (file === null) throw new RefinementProviderError('trajectory-not-found', `run "${request.runId}" has no canonical trajectory`)
    const parsed = canonicalLines(verifiedFile(loaded.directory, file))
    return { runId: request.runId, header: parsed.header, events: parsed.events }
  }

  /** Read one checksum-validated provider evidence page under its complete encoded byte bound. */
  async providerEvidence(request: RefinementProviderEvidenceLookup): Promise<RefinementProviderEvidencePage> {
    const loaded = await this.ownedRun(request.evalRef, request.runId)
    const file = loaded.trajectory.providers[request.fileOrdinal]
    if (file === undefined) throw new RefinementProviderError('trajectory-not-found', 'provider evidence file was not found')
    const bytes = verifiedFile(loaded.directory, file)
    const offset = this.decodeCursor(request.cursor, file)
    if (offset > bytes.length) throw new RefinementProviderError('trajectory-corrupt', 'provider evidence cursor is beyond the file')
    const text = file.mediaType.startsWith('text/') || file.mediaType.includes('json')
    if (text) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new RefinementProviderError('trajectory-corrupt', 'text provider evidence is not valid UTF-8')
      }
      if (offset < bytes.length && ((bytes[offset] as number) & 0xc0) === 0x80) {
        throw new RefinementProviderError('trajectory-corrupt', 'provider evidence cursor splits a UTF-8 code point')
      }
    }
    const descriptor = {
      ordinal: request.fileOrdinal,
      role: file.role,
      mediaType: file.mediaType,
      bytes: file.bytes,
      sha256: file.sha256,
    }
    let low = offset
    let high = bytes.length
    let accepted = offset
    while (low <= high) {
      const requestedEnd = low + Math.floor((high - low) / 2)
      const end = text ? utf8PageEnd(bytes, offset, requestedEnd) : requestedEnd
      const content = text ? bytes.subarray(offset, end).toString('utf8') : bytes.subarray(offset, end).toString('base64')
      const page: RefinementProviderEvidencePage = {
        runId: request.runId,
        file: descriptor,
        encoding: text ? 'utf8' : 'base64',
        content,
        nextCursor: end < bytes.length ? this.encodeCursor(end, file) : null,
      }
      if (Buffer.byteLength(JSON.stringify(page), 'utf8') <= request.maxBytes) {
        accepted = Math.max(accepted, end)
        low = requestedEnd + 1
      } else {
        high = requestedEnd - 1
      }
    }
    if (accepted === offset && offset < bytes.length) {
      throw new TypeError('providerEvidencePageMaxBytes is too small for its response metadata')
    }
    return {
      runId: request.runId,
      file: descriptor,
      encoding: text ? 'utf8' : 'base64',
      content: text ? bytes.subarray(offset, accepted).toString('utf8') : bytes.subarray(offset, accepted).toString('base64'),
      nextCursor: accepted < bytes.length ? this.encodeCursor(accepted, file) : null,
    }
  }

  /** Subscribe to eval and run-directory changes with one debounced callback. */
  watch(ref: RefinementEvaluationRef, onChange: () => void): () => void {
    this.assertRef(ref)
    const watchers: FSWatcher[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const notify = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(onChange, this.watchDebounceMs)
    }
    for (const path of [join(this.root, 'evals', ref.evalId), join(this.root, 'evals'), join(this.root, 'runs')]) {
      if (!existsSync(path)) continue
      watchers.push(watch(path, { persistent: false }, notify))
    }
    let active = true
    return () => {
      if (!active) return
      active = false
      if (timer !== undefined) clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
    }
  }

  /** Ensure a request cannot select another registered provider. */
  private assertRef(ref: RefinementEvaluationRef): void {
    if (ref.providerId !== this.id) throw new TypeError('refinement eval ref selects another provider')
    if (!EVAL_ID.test(ref.evalId)) throw new TypeError('refinement eval id is invalid')
  }

  /** Recover an optional task count from a machine plan without fabricating runs. */
  private plannedTasks(directory: string): number | null {
    const path = join(directory, 'plan.json')
    if (!existsSync(path)) return null
    try {
      const plan = object(json(path, 'Hitch eval plan'), 'Hitch eval plan')
      const tasks = plan['tasks']
      return Array.isArray(tasks) ? tasks.length : null
    } catch {
      return null
    }
  }

  /** Resolve one run only after proving its membership in the requested eval. */
  private async ownedRun(ref: RefinementEvaluationRef, runId: HitchRunId): Promise<LoadedRun> {
    const projection = await this.evaluation(ref)
    if (!projection.runs.some(run => run.id === runId)) {
      throw new RefinementProviderError('run-not-found', `run "${runId}" does not belong to eval "${ref.evalId}"`)
    }
    const result = parseEval(json(join(this.root, 'evals', ref.evalId, 'result.json'), 'Hitch eval result'), ref)
    const trial = result.trials.find(item => item.runId === runId)
    if (trial === undefined) throw new RefinementProviderError('run-not-found', `run "${runId}" was not found in eval result`)
    return loadRun(this.root, ref, trial)
  }

  /** Encode an evidence cursor tied to one immutable digest. */
  private encodeCursor(offset: number, file: TrajectoryFile): string {
    return Buffer.from(JSON.stringify({ offset, digest: file.sha256 }), 'utf8').toString('base64url')
  }

  /** Decode and validate an evidence cursor. */
  private decodeCursor(cursor: string | null, file: TrajectoryFile): number {
    if (cursor === null) return 0
    try {
      const value = object(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')), 'provider cursor')
      if (value['digest'] !== file.sha256 || typeof value['offset'] !== 'number'
        || !Number.isSafeInteger(value['offset']) || value['offset'] < 0) throw new TypeError('invalid cursor')
      return value['offset']
    } catch {
      throw new RefinementProviderError('trajectory-corrupt', 'provider evidence cursor is invalid')
    }
  }
}
