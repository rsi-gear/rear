/** Read-only Hitch run-centered evidence provider. @module dsh-plugin-rear/hitch-provider */

import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, watch,
} from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { TextDecoder } from 'node:util'
import s from '@deepseek-ai/schemastery'
import { packChunkRuns } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session/types'
import type {
  CanonicalTrajectoryDocument,
  CanonicalTrajectoryEvent,
  CanonicalTrajectoryRecord,
  HitchEvalId,
  HitchRunId,
  RefinementComparisonExclusion,
  RefinementEvaluationProjection,
  RefinementEvaluationPhase,
  RefinementEvaluationRef,
  RefinementFailure,
  RefinementInteractionEvidencePage,
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
  RefinementInteractionEvidenceLookup,
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
  readonly verifierResultRef?: string
}

interface EvalResult {
  readonly evalId: HitchEvalId
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  readonly status: 'succeeded' | 'failed' | 'cancelled'
  readonly trials: readonly EvalTrial[]
  readonly failure?: RefinementFailure
}

interface EvalMembership {
  readonly evalId: HitchEvalId
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  readonly status: 'queued' | 'running' | 'rerunning' | 'succeeded' | 'failed' | 'cancelled'
  readonly phase?: RefinementEvaluationPhase
  readonly trials: readonly EvalTrial[]
  readonly partial: boolean
  readonly plannedTasks: number | null
  readonly failure?: RefinementFailure
}

interface EvalControl {
  readonly state: RefinementEvaluationPhase | 'succeeded' | 'failed' | 'cancelled'
  readonly failure?: RefinementFailure
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
  readonly interaction: TrajectoryFile | null
}

interface BundleFile {
  readonly role: string
  readonly path: string
  readonly size: number
  readonly sha256: string
}

interface BundleProjection {
  readonly digest: string
  readonly executionEvidence?: RefinementRunView['executionEvidence']
  readonly capture?: RefinementRunView['capture']
  readonly interaction?: TrajectoryFile
}

const RUN_ID = /^run_[a-f0-9]{32}$/u
const EVAL_ID = /^eval_[A-Za-z0-9._-]+$/u
const RERUN_ID = /^rerun_[a-f0-9]{32}$/u
const SHA256 = /^sha256:[a-f0-9]{64}$/u
const LEASE_ID = /^lease_[a-f0-9]{32}$/u
const WORK_ID = /^work_[a-f0-9]{32}$/u
const ALLOCATION_ID = /^allocation_[a-f0-9]{32}$/u
const TERMINAL = new Set(['succeeded', 'failed', 'timed_out', 'cancelled'])
const CONTROL_PHASES = new Set<RefinementEvaluationPhase>(['queued', 'planning', 'preparing', 'running', 'finalizing', 'cancelling'])
const CONTROL_TERMINAL = new Set(['succeeded', 'failed', 'cancelled'])
const RERUN_TYPES = new Set(['candidate-restart', 'candidate-resume', 'trajectory-replay', 'verifier-only', 'collect-only'])
const BUNDLE_ROLES = new Set([
  'request', 'resolution', 'manifest', 'result', 'runtime-ref', 'environment-manifest',
  'execution-evidence', 'control-events', 'process-log', 'workspace-evidence', 'trajectory',
  'provider-evidence', 'verifier-evidence', 'interaction-capture', 'eval-publication', 'diagnostic',
])

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
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/** Match Hitch's canonical JSON digest for immutable control and bundle records. */
function jsonDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

/** Parse a bounded persisted failure without interpreting provider-specific codes. */
function failure(value: unknown, label: string): RefinementFailure | undefined {
  if (value === undefined) return undefined
  const record = object(value, label)
  const code = string(record['code'], `${label} code`)
  if (typeof record['message'] !== 'string') throw new TypeError(`${label} message must be a string`)
  return { code, message: record['message'] }
}

/** Validate a unique array of persisted identifiers. */
function identifiers(value: unknown, pattern: RegExp, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !pattern.test(item))) {
    throw new TypeError(`${label} is invalid`)
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} contains duplicates`)
  return value as string[]
}

/** Normalize a bundle-relative path using Hitch's portable path contract. */
function bundleRelativePath(value: unknown, label: string): string {
  const path = string(value, label)
  if (path.normalize('NFC') !== path || path.includes('\\') || path.startsWith('/')
    || path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError(`${label} is not a canonical relative path`)
  }
  return path
}

/** Hash a regular file without buffering large diagnostic logs in memory. */
function fileDigest(path: string): string {
  const descriptor = openSync(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytes === 0) break
      hash.update(buffer.subarray(0, bytes))
    }
  } finally {
    closeSync(descriptor)
  }
  return `sha256:${hash.digest('hex')}`
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
    if (event.type === 'assistant/chunk' && firstToken === undefined) {
      const chunk = object(object(event.data, 'assistant chunk data')['chunk'], 'assistant chunk')
      if (chunk['type'] === 'text-delta' || chunk['type'] === 'reasoning-delta' || chunk['type'] === 'tool-call-delta') {
        firstToken = event.time
      }
    }
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
function parseTrial(value: unknown, index: number, label: string): EvalTrial {
  const trial = object(value, `${label} trial ${index}`)
  const runId = string(trial['run_id'], `${label} trial ${index} run_id`)
  if (!RUN_ID.test(runId)) throw new TypeError(`${label} trial ${index} run_id is invalid`)
  const status = trial['observation_status']
  if (status !== 'valid' && status !== 'invalid') throw new TypeError(`${label} trial ${index} observation is invalid`)
  return {
    trialId: string(trial['trial_id'], `${label} trial ${index} trial_id`),
    runId: runId as HitchRunId,
    taskId: string(trial['task_id'], `${label} trial ${index} task_id`),
    attempt: positiveInteger(trial['attempt'], `${label} trial ${index} attempt`),
    observationStatus: status,
    ...(status === 'valid' ? { reward: finite(trial['reward'], `${label} trial ${index} reward`) } : {
      invalidReason: string(trial['invalid_reason'], `${label} trial ${index} invalid_reason`),
    }),
    ...(trial['verifier_result_ref'] === undefined ? {} : {
      verifierResultRef: string(trial['verifier_result_ref'], `${label} trial ${index} verifier_result_ref`),
    }),
  }
}

function uniqueTrials(trials: readonly EvalTrial[], label: string): void {
  if (new Set(trials.map(trial => trial.runId)).size !== trials.length
    || new Set(trials.map(trial => trial.trialId)).size !== trials.length) {
    throw new TypeError(`${label} trial identities must be unique`)
  }
}

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
  const trials = record['trials'].map((trial, index) => parseTrial(trial, index, 'Hitch eval'))
  uniqueTrials(trials, 'Hitch eval')
  const evalFailure = failure(record['error'], 'Hitch eval error')
  return {
    evalId: expected.evalId,
    benchmarkId: expected.benchmarkId,
    benchmarkRevision: expected.benchmarkRevision,
    status: record['status'] as EvalResult['status'],
    trials,
    ...(evalFailure === undefined ? {} : { failure: evalFailure }),
  }
}

function parseProgress(value: unknown, expected: RefinementEvaluationRef): EvalMembership {
  const record = object(value, 'Hitch eval progress')
  if (record['schema_version'] !== '1' || record['eval_id'] !== expected.evalId || record['status'] !== 'running') {
    throw new TypeError('Hitch eval progress identity/status mismatch')
  }
  if (record['benchmark_id'] !== expected.benchmarkId || record['benchmark_revision'] !== expected.benchmarkRevision) {
    throw new TypeError('Hitch eval progress benchmark identity mismatch')
  }
  nonNegativeInteger(record['generation'], 'Hitch eval progress generation')
  const plannedTasks = record['planned_tasks'] === null
    ? null
    : nonNegativeInteger(record['planned_tasks'], 'Hitch eval progress planned_tasks')
  const plannedTrials = record['planned_trials'] === null
    ? null
    : nonNegativeInteger(record['planned_trials'], 'Hitch eval progress planned_trials')
  if (!Array.isArray(record['trials'])) throw new TypeError('Hitch eval progress trials must be an array')
  const trials = record['trials'].map((trial, index) => parseTrial(trial, index, 'Hitch eval progress'))
  uniqueTrials(trials, 'Hitch eval progress')
  if (plannedTrials !== null && trials.length > plannedTrials) {
    throw new TypeError('Hitch eval progress has more settled than planned trials')
  }
  if (plannedTasks !== null && new Set(trials.map(trial => trial.taskId)).size > plannedTasks) {
    throw new TypeError('Hitch eval progress has more settled than planned tasks')
  }
  const sorted = [...trials].sort((left, right) => left.taskId.localeCompare(right.taskId)
    || left.attempt - right.attempt || left.trialId.localeCompare(right.trialId))
  if (sorted.some((trial, index) => trial !== trials[index])) throw new TypeError('Hitch eval progress trials are not canonical')
  const summary = object(record['summary'], 'Hitch eval progress summary')
  const valid = trials.filter(trial => trial.observationStatus === 'valid').length
  if (summary['settled_trials'] !== trials.length || summary['valid_trials'] !== valid
    || summary['invalid_trials'] !== trials.length - valid) {
    throw new TypeError('Hitch eval progress summary differs from trials')
  }
  if (timestamp(record['started_at']) === undefined || timestamp(record['updated_at']) === undefined) {
    throw new TypeError('Hitch eval progress timestamps are invalid')
  }
  return {
    evalId: expected.evalId,
    benchmarkId: expected.benchmarkId,
    benchmarkRevision: expected.benchmarkRevision,
    status: 'running',
    trials,
    partial: true,
    plannedTasks,
  }
}

function trialIdentity(trial: EvalTrial): string {
  return canonicalJson({
    trialId: trial.trialId,
    runId: trial.runId,
    taskId: trial.taskId,
    attempt: trial.attempt,
    observationStatus: trial.observationStatus,
    reward: trial.reward,
    invalidReason: trial.invalidReason,
    verifierResultRef: trial.verifierResultRef,
  })
}

function reconcileProgress(result: EvalResult, progress: EvalMembership): void {
  if (result.benchmarkId !== progress.benchmarkId || result.benchmarkRevision !== progress.benchmarkRevision
    || result.trials.length !== progress.trials.length) {
    throw new TypeError('Hitch eval result/progress membership mismatch')
  }
  const byTrial = new Map(progress.trials.map(trial => [trial.trialId, trialIdentity(trial)]))
  if (result.trials.some(trial => byTrial.get(trial.trialId) !== trialIdentity(trial))) {
    throw new TypeError('Hitch eval result/progress trial identity mismatch')
  }
}

/** Parse the additive daemon envelope while keeping progress/result authoritative for membership. */
function loadEvalControl(directory: string, expected: RefinementEvaluationRef): EvalControl | null {
  const submissionPath = join(directory, 'submission.json')
  if (!existsSync(submissionPath)) return null
  const submission = object(json(submissionPath, 'Hitch eval submission'), 'Hitch eval submission')
  if (submission['schema_version'] !== '1' || submission['eval_id'] !== expected.evalId) {
    throw new TypeError('Hitch eval submission identity mismatch')
  }
  const request = object(submission['request'], 'Hitch eval submitted request')
  const requestPath = join(directory, 'request.json')
  if (!existsSync(requestPath)) throw new TypeError('Hitch control-plane eval has no request')
  const persistedRequest = object(json(requestPath, 'Hitch eval request'), 'Hitch eval request')
  if (canonicalJson(request) !== canonicalJson(persistedRequest)) {
    throw new TypeError('Hitch eval submission/request mismatch')
  }
  const submissionDigest = string(submission['submission_digest'], 'Hitch eval submission digest')
  if (!SHA256.test(submissionDigest)) throw new TypeError('Hitch eval submission digest is invalid')
  const expectedDigest = submission['execution'] === undefined
    ? jsonDigest(request)
    : jsonDigest({ request, execution: object(submission['execution'], 'Hitch eval execution policy') })
  if (submissionDigest !== expectedDigest) throw new TypeError('Hitch eval submission digest mismatch')
  if (submission['idempotency_key_hash'] !== undefined
    && (typeof submission['idempotency_key_hash'] !== 'string' || !SHA256.test(submission['idempotency_key_hash']))) {
    throw new TypeError('Hitch eval idempotency key hash is invalid')
  }
  if (timestamp(submission['submitted_at']) === undefined) throw new TypeError('Hitch eval submission timestamp is invalid')

  const controlPath = join(directory, 'control.json')
  if (!existsSync(controlPath)) throw new TypeError('Hitch control-plane eval has no control state')
  const control = object(json(controlPath, 'Hitch eval control'), 'Hitch eval control')
  const state = control['state']
  if (control['schema_version'] !== '1' || control['eval_id'] !== expected.evalId
    || typeof state !== 'string' || (!CONTROL_PHASES.has(state as RefinementEvaluationPhase) && !CONTROL_TERMINAL.has(state))) {
    throw new TypeError('Hitch eval control identity/status mismatch')
  }
  nonNegativeInteger(control['generation'], 'Hitch eval control generation')
  positiveInteger(control['requested_parallelism'], 'Hitch eval requested parallelism')
  nonNegativeInteger(control['admitted_parallelism'], 'Hitch eval admitted parallelism')
  identifiers(control['active_leases'], LEASE_ID, 'Hitch eval active leases')
  identifiers(control['queued_work_items'], WORK_ID, 'Hitch eval queued work items')
  identifiers(control['terminal_work_items'], WORK_ID, 'Hitch eval terminal work items')
  if (control['allocation_id'] !== undefined
    && (typeof control['allocation_id'] !== 'string' || !ALLOCATION_ID.test(control['allocation_id']))) {
    throw new TypeError('Hitch eval allocation identity is invalid')
  }
  if (control['cancel_requested_at'] !== undefined && timestamp(control['cancel_requested_at']) === undefined) {
    throw new TypeError('Hitch eval cancellation timestamp is invalid')
  }
  if (timestamp(control['created_at']) === undefined || timestamp(control['updated_at']) === undefined) {
    throw new TypeError('Hitch eval control timestamps are invalid')
  }
  const controlFailure = failure(control['error'], 'Hitch eval control error')
  return {
    state: state as EvalControl['state'],
    ...(controlFailure === undefined ? {} : { failure: controlFailure }),
  }
}

/** Return whether Hitch has one validated active task-level rerun. */
function hasActiveRerun(directory: string, evalId: HitchEvalId): boolean {
  const reruns = join(directory, 'reruns')
  if (!existsSync(reruns)) return false
  const info = lstatSync(reruns)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Hitch eval reruns directory is invalid')
  let queued = 0
  let running = 0
  for (const entry of readdirSync(reruns, { withFileTypes: true })) {
    if (!RERUN_ID.test(entry.name)) continue
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new TypeError('Hitch eval rerun directory is invalid')
    const statePath = join(reruns, entry.name, 'state.json')
    if (!existsSync(statePath)) continue
    const state = object(json(statePath, 'Hitch eval rerun state'), 'Hitch eval rerun state')
    if (state['schema_version'] !== '1' || state['rerun_id'] !== entry.name || state['eval_id'] !== evalId
      || !['queued', 'running', 'completed', 'failed'].includes(String(state['status']))) {
      throw new TypeError('Hitch eval rerun state identity/status mismatch')
    }
    if (state['rerun_type'] !== undefined && (typeof state['rerun_type'] !== 'string' || !RERUN_TYPES.has(state['rerun_type']))) {
      throw new TypeError('Hitch eval rerun type is invalid')
    }
    if (state['semantics'] !== undefined) object(state['semantics'], 'Hitch eval rerun semantics')
    if (!Array.isArray(state['tasks']) || !Array.isArray(state['repaired_tasks'])
      || state['tasks'].some(task => typeof task !== 'string' || task.length === 0)
      || state['repaired_tasks'].some(task => typeof task !== 'string' || task.length === 0)
      || timestamp(state['updated_at']) === undefined) {
      throw new TypeError('Hitch eval rerun state is invalid')
    }
    for (const name of ['trials', 'repaired_trials', 'remaining_invalid_trials']) {
      const trials = state[name]
      if (trials === undefined) continue
      if (!Array.isArray(trials) || trials.some((value) => {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) return true
        const trial = value as JsonRecord
        return typeof trial['task_id'] !== 'string' || trial['task_id'].length === 0
          || typeof trial['attempt'] !== 'number' || !Number.isSafeInteger(trial['attempt']) || trial['attempt'] < 1
      })) throw new TypeError(`Hitch eval rerun ${name} is invalid`)
    }
    const status = state['status']
    if (status === 'queued') {
      if (timestamp(state['submitted_at']) === undefined) throw new TypeError('Hitch queued rerun timestamp is invalid')
      queued += 1
    } else if (timestamp(state['started_at']) === undefined) {
      throw new TypeError('Hitch eval rerun start timestamp is invalid')
    }
    if ((status === 'completed' || status === 'failed') && timestamp(state['completed_at']) === undefined) {
      throw new TypeError('Hitch eval rerun completion timestamp is invalid')
    }
    if (state['status'] === 'running') running += 1
  }
  if (running > 1) throw new TypeError('Hitch eval has multiple active reruns')
  return queued > 0 || running === 1
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

/** Classify one result-bundle path exactly as Hitch does. */
function bundleRole(path: string): string {
  if (path === 'request.json') return 'request'
  if (path === 'resolution.json') return 'resolution'
  if (path === 'manifest.json') return 'manifest'
  if (path === 'result.json') return 'result'
  if (path === 'runtime.ref.json') return 'runtime-ref'
  if (path === 'execution.json') return 'execution-evidence'
  if (path === 'events.jsonl') return 'control-events'
  if (path === 'workspace.json' || path.startsWith('workspace/')) return 'workspace-evidence'
  if (path === 'environment/image.manifest.json') return 'environment-manifest'
  if (path.startsWith('interactions/')) return 'interaction-capture'
  if (path === 'eval/publication.json') return 'eval-publication'
  if (path.startsWith('verifier/')) return 'verifier-evidence'
  if (path === 'trajectory.ref.json' || path.startsWith('trajectory/')) return 'trajectory'
  if (path.startsWith('provider/') || path.includes('provider-native')) return 'provider-evidence'
  if (/(?:^|\/)(?:stdout|stderr)\.log$/u.test(path) || path.endsWith('.stdout.log') || path.endsWith('.stderr.log')) return 'process-log'
  return 'diagnostic'
}

/** Enumerate and hash a sealed run without following links or buffering large files. */
function actualBundleFiles(root: string, directory = root, prefix = ''): BundleFile[] {
  const files: BundleFile[] = []
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))
  for (const entry of entries) {
    if (entry.name.normalize('NFC') !== entry.name || entry.name.includes('\\') || entry.name === '.' || entry.name === '..') {
      throw new TypeError('Hitch result bundle path is not canonical')
    }
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    const absolutePath = join(directory, entry.name)
    const info = lstatSync(absolutePath)
    if (info.isDirectory() && !info.isSymbolicLink()) {
      files.push(...actualBundleFiles(root, absolutePath, relativePath))
      continue
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new TypeError(`Hitch result bundle contains an unsafe entry: ${relativePath}`)
    }
    if (relativePath === 'bundle.index.json') continue
    files.push({
      role: bundleRole(relativePath),
      path: relativePath,
      size: info.size,
      sha256: fileDigest(absolutePath),
    })
  }
  return files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
}

/** Parse the environment/resource summary already committed by the bundle digest. */
function bundleExecutionEvidence(record: JsonRecord): RefinementRunView['executionEvidence'] | undefined {
  if (record['environment'] === undefined && record['resources'] === undefined) return undefined
  const environment = record['environment'] === undefined
    ? null
    : object(record['environment'], 'Hitch bundle environment')
  const provider = environment === null ? 'unknown' : string(environment['provider'], 'Hitch bundle execution provider')
  const imagesValue = environment?.['images'] ?? []
  if (!Array.isArray(imagesValue)) throw new TypeError('Hitch bundle environment images are invalid')
  const images = imagesValue.map((value, index) => {
    const image = object(value, `Hitch bundle image ${index}`)
    const imageId = string(image['image_id'], `Hitch bundle image ${index} id`)
    const imageDigest = string(image['image_digest'], `Hitch bundle image ${index} digest`)
    if (!SHA256.test(imageId) || !SHA256.test(imageDigest)) throw new TypeError(`Hitch bundle image ${index} identity is invalid`)
    return { imageId, imageDigest, reference: string(image['reference'], `Hitch bundle image ${index} reference`) }
  })
  if (new Set(images.map(image => image.imageId)).size !== images.length) throw new TypeError('Hitch bundle images are duplicated')
  const resources = record['resources'] === undefined ? null : object(record['resources'], 'Hitch bundle resources')
  const resourceRecord = (value: unknown, label: string): Readonly<Record<string, number>> => {
    const parsed = object(value, label)
    for (const [name, amount] of Object.entries(parsed)) {
      if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
        throw new TypeError(`${label} ${name} is invalid`)
      }
    }
    return parsed as Readonly<Record<string, number>>
  }
  const requested = resources === null ? undefined : resourceRecord(resources['requested'], 'Hitch bundle requested resources')
  const observed = resources?.['observed'] === undefined
    ? undefined
    : resourceRecord(resources['observed'], 'Hitch bundle observed resources')
  const workerId = environment?.['worker_id']
  const leaseId = environment?.['lease_id']
  if (workerId !== undefined && (typeof workerId !== 'string' || workerId.length === 0)) throw new TypeError('Hitch bundle worker id is invalid')
  if (leaseId !== undefined && (typeof leaseId !== 'string' || !LEASE_ID.test(leaseId))) throw new TypeError('Hitch bundle lease id is invalid')
  return {
    provider,
    ...(workerId === undefined ? {} : { workerId }),
    ...(leaseId === undefined ? {} : { leaseId }),
    images,
    ...(requested === undefined ? {} : { requestedResources: requested }),
    ...(observed === undefined ? {} : { observedResources: observed }),
  }
}

/** Parse the model-capture summary without treating it as canonical trajectory evidence. */
function bundleCapture(record: JsonRecord): RefinementRunView['capture'] | undefined {
  if (record['capture'] === undefined) return undefined
  const capture = object(record['capture'], 'Hitch bundle capture')
  const mode = capture['mode']
  const completeness = capture['completeness']
  if (!['off', 'native', 'proxy', 'hybrid'].includes(String(mode))
    || !['complete', 'partial', 'none'].includes(String(completeness))
    || typeof capture['required'] !== 'boolean') {
    throw new TypeError('Hitch bundle capture policy is invalid')
  }
  const interactionCount = nonNegativeInteger(capture['interaction_count'], 'Hitch bundle interaction count')
  const redaction = object(capture['redaction'], 'Hitch bundle capture redaction')
  const redactionStatus = redaction['status']
  if (!['applied', 'not-needed', 'failed'].includes(String(redactionStatus))) {
    throw new TypeError('Hitch bundle capture redaction status is invalid')
  }
  return {
    mode: mode as NonNullable<RefinementRunView['capture']>['mode'],
    required: capture['required'],
    completeness: completeness as NonNullable<RefinementRunView['capture']>['completeness'],
    interactionCount,
    interactionAvailable: record['interaction_ref'] !== undefined,
    redaction: {
      policy: string(redaction['policy'], 'Hitch bundle redaction policy'),
      status: redactionStatus as NonNullable<RefinementRunView['capture']>['redaction']['status'],
    },
  }
}

/** Validate the interaction reference/rows committed by a sealed bundle and return its page source. */
function bundleInteraction(
  directory: string,
  index: JsonRecord,
  trial: EvalTrial,
  files: readonly BundleFile[],
  capture: RefinementRunView['capture'] | undefined,
): TrajectoryFile | undefined {
  if (index['interaction_ref'] === undefined) return undefined
  const refPath = bundleRelativePath(index['interaction_ref'], 'Hitch bundle interaction ref')
  if (refPath !== 'interactions/interaction.ref.json') throw new TypeError('Hitch bundle interaction ref is not canonical')
  const refFile = files.find(file => file.path === refPath)
  if (refFile === undefined || refFile.role !== 'interaction-capture' || refFile.size > 1024 * 1024) {
    throw new TypeError('Hitch bundle interaction ref file is invalid')
  }
  const ref = object(json(join(directory, ...refPath.split('/')), 'Hitch interaction capture ref'), 'Hitch interaction capture ref')
  const allowedRefFields = new Set([
    'schema_version', 'run_id', 'mode', 'required', 'topology', 'completeness', 'interaction_count',
    'interactions_ref', 'redaction',
  ])
  if (Object.keys(ref).some(key => !allowedRefFields.has(key)) || ref['schema_version'] !== '1'
    || ref['run_id'] !== trial.runId || !['proxy', 'hybrid'].includes(String(ref['mode']))
    || typeof ref['required'] !== 'boolean' || !['host-side', 'in-sandbox'].includes(String(ref['topology']))
    || !['complete', 'partial', 'none'].includes(String(ref['completeness']))) {
    throw new TypeError('Hitch interaction capture identity is invalid')
  }
  const count = nonNegativeInteger(ref['interaction_count'], 'Hitch interaction count')
  if ((ref['completeness'] === 'none') !== (count === 0)) throw new TypeError('Hitch interaction capture completeness is inconsistent')
  const rowsPath = bundleRelativePath(ref['interactions_ref'], 'Hitch interaction rows ref')
  if (rowsPath !== 'interactions/interactions.jsonl') throw new TypeError('Hitch interaction rows ref is not canonical')
  const rowsFile = files.find(file => file.path === rowsPath)
  if (rowsFile === undefined || rowsFile.role !== 'interaction-capture' || rowsFile.size > 64 * 1024 * 1024) {
    throw new TypeError('Hitch interaction rows file is invalid')
  }
  const redaction = object(ref['redaction'], 'Hitch interaction redaction')
  if (Object.keys(redaction).some(key => !['policy', 'status', 'rules'].includes(key))
    || typeof redaction['policy'] !== 'string' || redaction['policy'].length < 1 || redaction['policy'].length > 256
    || !['applied', 'not-needed', 'failed'].includes(String(redaction['status'])) || !Array.isArray(redaction['rules'])) {
    throw new TypeError('Hitch interaction redaction is invalid')
  }
  const rules = redaction['rules'].map((value, ordinal) => {
    const rule = object(value, `Hitch interaction redaction rule ${ordinal}`)
    if (Object.keys(rule).some(key => !['rule_id', 'count'].includes(key))) throw new TypeError('Hitch interaction redaction rule has unknown fields')
    return {
      rule_id: string(rule['rule_id'], `Hitch interaction redaction rule ${ordinal} id`),
      count: positiveInteger(rule['count'], `Hitch interaction redaction rule ${ordinal} count`),
    }
  })
  const sortedRules = [...rules].sort((left, right) => Buffer.from(left.rule_id).compare(Buffer.from(right.rule_id)))
  if (canonicalJson(sortedRules) !== canonicalJson(rules) || new Set(rules.map(rule => rule.rule_id)).size !== rules.length) {
    throw new TypeError('Hitch interaction redaction rules are not canonical')
  }
  if (capture === undefined || capture.mode !== ref['mode'] || capture.required !== ref['required']
    || capture.completeness !== ref['completeness'] || capture.interactionCount !== count
    || capture.redaction.policy !== redaction['policy'] || capture.redaction.status !== redaction['status']) {
    throw new TypeError('Hitch interaction capture differs from bundle summary')
  }
  const rowsBytes = regular(join(directory, ...rowsPath.split('/')))
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(rowsBytes)
  } catch {
    throw new TypeError('Hitch interaction rows are not valid UTF-8')
  }
  const rows = text.split(/\r?\n/u).filter(line => line.length > 0)
  if (rows.length !== count) throw new TypeError('Hitch interaction row count differs from its ref')
  rows.forEach((line, ordinal) => {
    let row: JsonRecord
    try {
      row = object(JSON.parse(line), `Hitch interaction row ${ordinal + 1}`)
    } catch (error) {
      throw new TypeError(`Hitch interaction row ${ordinal + 1} is invalid: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (row['schema_version'] !== '1' || row['run_id'] !== trial.runId || row['sequence'] !== ordinal + 1
      || typeof row['interaction_id'] !== 'string' || !/^interaction_[a-f0-9]{32}$/u.test(row['interaction_id'])
      || typeof row['requested_model'] !== 'string' || row['requested_model'].length === 0
      || typeof row['endpoint_identity'] !== 'string' || !SHA256.test(row['endpoint_identity'])
      || !['succeeded', 'failed', 'cancelled'].includes(String(row['status']))
      || timestamp(row['started_at']) === undefined) {
      throw new TypeError(`Hitch interaction row ${ordinal + 1} identity is invalid`)
    }
    for (const kind of ['request', 'response'] as const) {
      const field = `${kind}_ref`
      if (row[field] === undefined) continue
      const payloadPath = bundleRelativePath(row[field], `Hitch interaction ${kind} ref`)
      if (payloadPath !== `interactions/payloads/${row['interaction_id']}.${kind}.json`
        || !files.some(file => file.path === payloadPath && file.role === 'interaction-capture')) {
        throw new TypeError(`Hitch interaction ${kind} ref is invalid`)
      }
    }
  })
  return {
    role: 'interaction-capture',
    path: rowsFile.path,
    mediaType: 'application/x-ndjson',
    sha256: rowsFile.sha256,
    bytes: rowsFile.size,
  }
}

/** Verify Hitch's additive sealed bundle and its eval-publication receipt. */
function verifyResultBundle(
  directory: string,
  ref: RefinementEvaluationRef,
  trial: EvalTrial,
  manifest: JsonRecord,
  cache: Map<string, BundleProjection>,
): BundleProjection | null {
  const indexPath = join(directory, 'bundle.index.json')
  if (!existsSync(indexPath)) return null
  const indexBytes = regular(indexPath)
  const signature = `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`
  const cacheKey = `${directory}\u0000${ref.evalId}\u0000${trialIdentity(trial)}`
  const cached = cache.get(cacheKey)
  if (cached?.digest === signature) return cached
  let parsed: unknown
  try {
    parsed = JSON.parse(indexBytes.toString('utf8'))
  } catch (error) {
    throw new TypeError(`Hitch result bundle index is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  const index = object(parsed, 'Hitch result bundle index')
  if (index['schema_version'] !== '1' || index['run_id'] !== trial.runId || index['sealed'] !== true) {
    throw new TypeError('Hitch result bundle identity mismatch')
  }
  const contextIdentity = string(index['context_identity'], 'Hitch result bundle context identity')
  const bundleDigest = string(index['bundle_digest'], 'Hitch result bundle digest')
  if (!SHA256.test(contextIdentity) || !SHA256.test(bundleDigest)) throw new TypeError('Hitch result bundle digest is invalid')
  if (timestamp(index['created_at']) === undefined) throw new TypeError('Hitch result bundle timestamp is invalid')
  if (!Array.isArray(index['files'])) throw new TypeError('Hitch result bundle files are invalid')
  const declaredFiles = index['files'].map((value, ordinal): BundleFile => {
    const file = object(value, `Hitch result bundle file ${ordinal}`)
    if (Object.keys(file).some(key => !['role', 'path', 'size', 'sha256'].includes(key))) {
      throw new TypeError(`Hitch result bundle file ${ordinal} has unknown fields`)
    }
    const role = string(file['role'], `Hitch result bundle file ${ordinal} role`)
    const path = bundleRelativePath(file['path'], `Hitch result bundle file ${ordinal} path`)
    const digest = string(file['sha256'], `Hitch result bundle file ${ordinal} digest`)
    if (!BUNDLE_ROLES.has(role) || !SHA256.test(digest)) throw new TypeError(`Hitch result bundle file ${ordinal} is invalid`)
    return { role, path, size: nonNegativeInteger(file['size'], `Hitch result bundle file ${ordinal} size`), sha256: digest }
  })
  const sortedFiles = [...declaredFiles].sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)))
  if (canonicalJson(sortedFiles) !== canonicalJson(declaredFiles)
    || new Set(declaredFiles.map(file => file.path)).size !== declaredFiles.length) {
    throw new TypeError('Hitch result bundle file list is not canonical')
  }
  const actualFiles = actualBundleFiles(directory)
  if (canonicalJson(actualFiles) !== canonicalJson(declaredFiles)) {
    throw new TypeError('Hitch result bundle file set or integrity mismatch')
  }
  const expectedContextIdentity = jsonDigest({
    context: manifest['context'],
    parent: manifest['parent'],
    harness: manifest['harness'],
    model: manifest['model'],
    protocol: manifest['protocol'],
    observation: manifest['observation'],
  })
  if (contextIdentity !== expectedContextIdentity) throw new TypeError('Hitch result bundle context identity mismatch')
  const provenance = object(index['provenance'], 'Hitch result bundle provenance')
  const context = object(manifest['context'], 'Hitch run context')
  const harness = object(manifest['harness'], 'Hitch run harness')
  if (provenance['benchmark_id'] !== undefined && provenance['benchmark_id'] !== context['benchmark_id']
    || provenance['benchmark_revision'] !== undefined && provenance['benchmark_revision'] !== context['benchmark_revision']
    || provenance['harness_revision'] !== undefined && provenance['harness_revision'] !== harness['revision_identity']) {
    throw new TypeError('Hitch result bundle provenance mismatch')
  }
  const { bundle_digest: _bundleDigest, created_at: _createdAt, ...identity } = index
  if (jsonDigest(identity) !== bundleDigest) throw new TypeError('Hitch result bundle digest mismatch')

  const publicationPath = join(directory, 'eval', 'publication.json')
  if (!existsSync(publicationPath)) throw new TypeError('Hitch eval run has no publication receipt')
  const publication = object(json(publicationPath, 'Hitch eval publication'), 'Hitch eval publication')
  if (publication['schema_version'] !== '1' || publication['eval_id'] !== ref.evalId
    || !['settle', 'replace-invalid'].includes(String(publication['mode']))
    || timestamp(publication['created_at']) === undefined) {
    throw new TypeError('Hitch eval publication identity is invalid')
  }
  const publicationTrial = parseTrial(publication['trial'], 0, 'Hitch eval publication')
  if (trialIdentity(publicationTrial) !== trialIdentity(trial)) throw new TypeError('Hitch eval publication trial mismatch')

  const executionEvidence = bundleExecutionEvidence(index)
  const capture = bundleCapture(index)
  const interaction = bundleInteraction(directory, index, trial, declaredFiles, capture)
  const projection: BundleProjection = {
    digest: signature,
    ...(executionEvidence === undefined ? {} : { executionEvidence }),
    ...(capture === undefined ? {} : { capture }),
    ...(interaction === undefined ? {} : { interaction }),
  }
  cache.set(cacheKey, projection)
  return projection
}

/** Load and cross-check one run referenced by an eval trial. */
function loadRun(
  root: string,
  ref: RefinementEvaluationRef,
  trial: EvalTrial,
  bundleCache: Map<string, BundleProjection>,
): LoadedRun {
  const directory = join(root, 'runs', trial.runId)
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || basename(realpathSync(directory)) !== trial.runId) {
    throw new TypeError('Hitch run directory is invalid')
  }
  const manifest = object(json(join(directory, 'manifest.json'), 'Hitch run manifest'), 'Hitch run manifest')
  if (manifest['schema_version'] !== '1' || manifest['run_id'] !== trial.runId) throw new TypeError('Hitch run identity mismatch')
  if (manifest['sealed'] !== true) throw new TypeError('Hitch eval run is not sealed')
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
  if (trial.verifierResultRef !== undefined && observation?.['verifier_result_ref'] !== trial.verifierResultRef) {
    throw new TypeError('Hitch run verifier reference differs from eval trial')
  }
  const harness = object(manifest['harness'], 'Hitch run harness')
  const model = object(manifest['model'], 'Hitch run model')
  const protocol = object(manifest['protocol'], 'Hitch run protocol')
  const bundle = verifyResultBundle(directory, ref, trial, manifest, bundleCache)
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
    ...(bundle?.executionEvidence === undefined ? {} : { executionEvidence: bundle.executionEvidence }),
    ...(bundle?.capture === undefined ? {} : { capture: bundle.capture }),
    trajectory: {
      availability: trajectory.availability,
      hasCanonical: trajectory.canonical !== null,
      providerFileCount: trajectory.providers.length,
      ...(trajectory.summary === undefined ? {} : { summary: trajectory.summary }),
    },
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  }
  return { directory, manifest, view, trajectory, interaction: bundle?.interaction ?? null }
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
  private readonly bundleCache = new Map<string, BundleProjection>()

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
    let membership: EvalMembership | null
    try {
      membership = this.membership(directory, ref)
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
    if (membership === null) {
      return {
        ref,
        status: 'running',
        plannedTasks: this.plannedTasks(directory),
        settledTasks: 0,
        runs: [],
        diagnostics: [],
      }
    }
    const runs: RefinementRunView[] = []
    const diagnostics: RefinementFailure[] = membership.failure === undefined ? [] : [membership.failure]
    for (const trial of membership.trials) {
      try {
        runs.push(loadRun(this.root, ref, trial, this.bundleCache).view)
      } catch (error) {
        diagnostics.push({ code: 'corrupt-run-link', message: `${trial.runId}: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    return {
      ref,
      status: membership.status,
      ...(membership.phase === undefined ? {} : { phase: membership.phase }),
      plannedTasks: membership.plannedTasks,
      settledTasks: new Set(membership.trials.map(trial => trial.taskId)).size,
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
      && projections.every(projection => projection.status === 'succeeded')
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
      const provisional = projections.some(projection => (projection.status === 'queued'
        || projection.status === 'running' || projection.status === 'rerunning')
        && (projection.ref.candidateId === referenceCandidate || projection.ref.candidateId === targetCandidate))
      return {
        taskKey,
        taskId: taskRuns[0]?.taskId ?? 'unknown',
        referenceRunIds: reference.map(run => run.id),
        candidateRunIds: candidate.map(run => run.id),
        referenceMean,
        candidateMean,
        delta: provisional || referenceMean === null || candidateMean === null ? null : candidateMean - referenceMean,
        status: provisional ? 'pending' : taskStatus(reference, candidate, referenceMean, candidateMean),
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
    const records = packChunkRuns(parsed.events as unknown as readonly SessionEvent[]) as unknown as CanonicalTrajectoryRecord[]
    return { runId: request.runId, header: parsed.header, records }
  }

  /** Read one checksum-validated provider evidence page under its complete encoded byte bound. */
  async providerEvidence(request: RefinementProviderEvidenceLookup): Promise<RefinementProviderEvidencePage> {
    const loaded = await this.ownedRun(request.evalRef, request.runId)
    const file = loaded.trajectory.providers[request.fileOrdinal]
    if (file === undefined) throw new RefinementProviderError('trajectory-not-found', 'provider evidence file was not found')
    return this.evidencePage(loaded.directory, request.runId, file, request.fileOrdinal, request.cursor, request.maxBytes)
  }

  /** Read independently captured model interactions without conflating them with the canonical trajectory. */
  async interactionEvidence(request: RefinementInteractionEvidenceLookup): Promise<RefinementInteractionEvidencePage> {
    const loaded = await this.ownedRun(request.evalRef, request.runId)
    if (loaded.interaction === null) {
      throw new RefinementProviderError('trajectory-not-found', `run "${request.runId}" has no model-interaction evidence`)
    }
    return this.evidencePage(loaded.directory, request.runId, loaded.interaction, 0, request.cursor, request.maxBytes)
  }

  /** Subscribe to eval and run-directory changes with one debounced callback. */
  watch(ref: RefinementEvaluationRef, onChange: () => void): () => void {
    this.assertRef(ref)
    return this.watchEval(ref.evalId, onChange)
  }

  /** Subscribe before benchmark identity is available, using only a Gear-owned eval id. */
  watchEval(evalId: HitchEvalId, onChange: () => void): () => void {
    if (!EVAL_ID.test(evalId)) throw new TypeError('refinement eval id is invalid')
    const watchers: FSWatcher[] = []
    let timer: ReturnType<typeof setTimeout> | undefined
    const notify = (): void => {
      this.bundleCache.clear()
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(onChange, this.watchDebounceMs)
    }
    for (const path of [join(this.root, 'evals', evalId), join(this.root, 'evals'), join(this.root, 'runs'), this.root]) {
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
    const legacyPath = join(directory, 'plan.json')
    if (existsSync(legacyPath)) {
      try {
        const plan = object(json(legacyPath, 'Hitch eval plan'), 'Hitch eval plan')
        const tasks = plan['tasks']
        if (Array.isArray(tasks)) return tasks.length
      } catch {
        // Fall through to the additive execution plan.
      }
    }
    const executionPath = join(directory, 'execution-plan.json')
    if (!existsSync(executionPath)) return null
    try {
      const plan = object(json(executionPath, 'Hitch eval execution plan'), 'Hitch eval execution plan')
      if (plan['schema_version'] !== '1' || plan['eval_id'] !== basename(directory) || !Array.isArray(plan['slots'])) return null
      const tasks = plan['slots'].map((value, index) => string(object(value, `Hitch eval slot ${index}`)['task_id'], `Hitch eval slot ${index} task`))
      return tasks.length === 0 ? null : new Set(tasks).size
    } catch {
      return null
    }
  }

  private membership(directory: string, ref: RefinementEvaluationRef): EvalMembership | null {
    const resultPath = join(directory, 'result.json')
    const progressPath = join(directory, 'progress.json')
    const control = loadEvalControl(directory, ref)
    const progress = existsSync(progressPath) ? parseProgress(json(progressPath, 'Hitch eval progress'), ref) : null
    const activeRerun = hasActiveRerun(directory, ref.evalId)
    if (ref.rerunning === true || activeRerun) {
      if (progress === null) throw new TypeError('Hitch rerun has no task-level progress')
      return { ...progress, status: 'rerunning', ...(control?.failure === undefined ? {} : { failure: control.failure }) }
    }
    if (!existsSync(resultPath)) {
      if (control !== null && CONTROL_TERMINAL.has(control.state)) {
        throw new TypeError('Hitch terminal control state has no result')
      }
      if (progress !== null) {
        return {
          ...progress,
          ...(control === null || CONTROL_TERMINAL.has(control.state) ? {} : { phase: control.state as RefinementEvaluationPhase }),
          ...(control?.failure === undefined ? {} : { failure: control.failure }),
        }
      }
      if (control === null) return null
      const phase = control.state as RefinementEvaluationPhase
      return {
        evalId: ref.evalId,
        benchmarkId: ref.benchmarkId,
        benchmarkRevision: ref.benchmarkRevision,
        status: phase === 'queued' ? 'queued' : 'running',
        phase,
        trials: [],
        partial: true,
        plannedTasks: this.plannedTasks(directory),
        ...(control.failure === undefined ? {} : { failure: control.failure }),
      }
    }
    const result = parseEval(json(resultPath, 'Hitch eval result'), ref)
    if (control !== null && CONTROL_TERMINAL.has(control.state) && control.state !== result.status) {
      throw new TypeError('Hitch eval control/result status mismatch')
    }
    if (progress !== null) reconcileProgress(result, progress)
    return {
      ...result,
      partial: false,
      plannedTasks: progress?.plannedTasks ?? new Set(result.trials.map(trial => trial.taskId)).size,
      ...(result.failure === undefined && control?.failure !== undefined ? { failure: control.failure } : {}),
    }
  }

  /** Resolve one run only after proving its membership in the requested eval. */
  private async ownedRun(ref: RefinementEvaluationRef, runId: HitchRunId): Promise<LoadedRun> {
    const projection = await this.evaluation(ref)
    if (!projection.runs.some(run => run.id === runId)) {
      throw new RefinementProviderError('run-not-found', `run "${runId}" does not belong to eval "${ref.evalId}"`)
    }
    const directory = join(this.root, 'evals', ref.evalId)
    const membership = this.membership(directory, ref)
    if (membership === null) throw new RefinementProviderError('run-not-found', `eval "${ref.evalId}" has no published membership`)
    const trial = membership.trials.find(item => item.runId === runId)
    if (trial === undefined) throw new RefinementProviderError('run-not-found', `run "${runId}" was not found in eval membership`)
    return loadRun(this.root, ref, trial, this.bundleCache)
  }

  /** Fit one checksum-validated file page inside the configured complete JSON response bound. */
  private evidencePage(
    directory: string,
    runId: HitchRunId,
    file: TrajectoryFile,
    ordinal: number,
    cursor: string | null,
    maxBytes: number,
  ): RefinementProviderEvidencePage {
    const bytes = verifiedFile(directory, file)
    const offset = this.decodeCursor(cursor, file)
    if (offset > bytes.length) throw new RefinementProviderError('trajectory-corrupt', 'evidence cursor is beyond the file')
    const text = file.mediaType.startsWith('text/') || file.mediaType.includes('json') || file.mediaType.includes('ndjson')
    if (text) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new RefinementProviderError('trajectory-corrupt', 'text evidence is not valid UTF-8')
      }
      if (offset < bytes.length && ((bytes[offset] as number) & 0xc0) === 0x80) {
        throw new RefinementProviderError('trajectory-corrupt', 'evidence cursor splits a UTF-8 code point')
      }
    }
    const descriptor = { ordinal, role: file.role, mediaType: file.mediaType, bytes: file.bytes, sha256: file.sha256 }
    let low = offset
    let high = bytes.length
    let accepted = offset
    while (low <= high) {
      const requestedEnd = low + Math.floor((high - low) / 2)
      const end = text ? utf8PageEnd(bytes, offset, requestedEnd) : requestedEnd
      const content = text ? bytes.subarray(offset, end).toString('utf8') : bytes.subarray(offset, end).toString('base64')
      const page: RefinementProviderEvidencePage = {
        runId,
        file: descriptor,
        encoding: text ? 'utf8' : 'base64',
        content,
        nextCursor: end < bytes.length ? this.encodeCursor(end, file) : null,
      }
      if (Buffer.byteLength(JSON.stringify(page), 'utf8') <= maxBytes) {
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
      runId,
      file: descriptor,
      encoding: text ? 'utf8' : 'base64',
      content: text ? bytes.subarray(offset, accepted).toString('utf8') : bytes.subarray(offset, accepted).toString('base64'),
      nextCursor: accepted < bytes.length ? this.encodeCursor(accepted, file) : null,
    }
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
