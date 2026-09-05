/** Readers for Hitch's sealed assessments, phase groups, and score channels. */
import { createHash } from 'node:crypto'
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readdirSync, readSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
export const runIdSchema = z.string().regex(/^run_[a-f0-9]{32}$/u)
export const assessmentRefSchema = z.object({ id: z.string().regex(/^assessment_[a-f0-9]{32}$/u), digest: digestSchema })
export const groupRefSchema = z.object({ run_group_id: z.string().regex(/^run_group_[a-f0-9]{32}$/u), digest: digestSchema })
export const scoresSchema = z.object({ total_score: z.number().finite(), process_score: z.number().finite().optional(), normalization: z.enum(['standard', 'legacy-reward']) })
const observationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid'), reward: z.number().finite(), verifier_result_ref: z.string().min(1).optional() }),
  z.object({ status: z.literal('invalid'), invalid_reason: z.string().min(1), verifier_result_ref: z.string().min(1).optional() }),
])
export type EvidenceObservation = z.infer<typeof observationSchema>
export type AssessmentRef = z.infer<typeof assessmentRefSchema>
export type GroupRef = z.infer<typeof groupRefSchema>
export type VerifierScores = z.infer<typeof scoresSchema>

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export function sha256(bytes: string | Buffer): string { return `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
export function jsonDigest(value: unknown): string { return sha256(canonicalJson(value)) }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Hitch evidence must be an object')
  return value as Record<string, unknown>
}

/** Reject symlinks at every path segment, including the evidence root. */
export function containedPath(root: string, ref: string): string {
  if (ref.includes('\\') || ref.split('/').some(s => !s || s === '.' || s === '..')) throw new TypeError('Invalid Hitch evidence path')
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new TypeError('Invalid Hitch evidence root')
  let path = realpathSync(root)
  for (const part of ref.split('/')) {
    path = join(path, part)
    if (lstatSync(path).isSymbolicLink()) throw new TypeError('Symlink in Hitch evidence path')
  }
  return path
}
export function evidenceBytes(root: string, ref: string, max = 16 * 1024 * 1024): Buffer {
  const path = containedPath(root, ref), stat = lstatSync(path)
  if (!stat.isFile() || stat.size > max) throw new TypeError(`Invalid or oversized Hitch evidence: ${ref}`)
  return readFileSync(path)
}
export function evidenceJson(root: string, ref: string): Record<string, unknown> {
  return object(JSON.parse(evidenceBytes(root, ref).toString('utf8')))
}

function fileDigest(path: string): string {
  const fd = openSync(path, 'r'), buffer = Buffer.alloc(1024 * 1024), hash = createHash('sha256')
  try { let n: number; while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n)) }
  finally { closeSync(fd) }
  return `sha256:${hash.digest('hex')}`
}

/** Hitch regrade inventory includes empty directories, file modes, and complete bytes. */
export function evidenceTreeDigest(directory: string): string {
  if (lstatSync(directory).isSymbolicLink()) throw new TypeError('Invalid assessment evidence root')
  directory = realpathSync(directory)
  const files: unknown[] = []
  let total = 0
  const visit = (ref: string): void => {
    const path = ref ? containedPath(directory, ref) : directory, stat = lstatSync(path)
    if (realpathSync(path) !== path || stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new TypeError('Invalid assessment evidence tree')
    if (files.length >= 100_000 || (total += stat.isFile() ? stat.size : 0) > 4 * 1024 ** 3) throw new TypeError('Assessment inventory exceeds limits')
    if (stat.isDirectory()) {
      files.push({ path: ref, type: 'directory' })
      for (const name of readdirSync(path).sort()) visit(ref ? `${ref}/${name}` : name)
    } else files.push({ path: ref, bytes: stat.size, mode: stat.mode & 0o777, sha256: fileDigest(path) })
  }
  visit('')
  return jsonDigest(files)
}

/** Verify every indexed file against an externally anchored sealed bundle index. */
export function verifyBundle(root: string, runId: string, expectedIndexDigest?: string): Record<string, unknown> {
  const directory = containedPath(root, `runs/${runIdSchema.parse(runId)}`)
  const index = evidenceJson(directory, 'bundle.index.json')
  if (expectedIndexDigest !== undefined && jsonDigest(index) !== digestSchema.parse(expectedIndexDigest)) throw new TypeError('Hitch bundle index digest mismatch')
  if (index['schema_version'] !== '1' || index['run_id'] !== runId || index['sealed'] !== true) throw new TypeError('Hitch bundle identity mismatch')
  const { bundle_digest: digest, created_at: _created, ...identity } = index
  if (jsonDigest(identity) !== digestSchema.parse(digest)) throw new TypeError('Hitch bundle digest mismatch')
  const files = z.array(z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: digestSchema })).parse(index['files'])
  if (new Set(files.map(f => f.path)).size !== files.length) throw new TypeError('Duplicate Hitch bundle file')
  const manifest = evidenceJson(directory, 'manifest.json')
  for (const ref of ['manifest.json', manifest['trajectory_ref'], manifest['result_ref']].filter(v => v !== undefined)) {
    if (!files.some(f => f.path === ref)) throw new TypeError('Hitch bundle omits run evidence')
  }
  for (const file of files) {
    const path = containedPath(directory, file.path), stat = lstatSync(path)
    if (!stat.isFile() || stat.size !== file.size || fileDigest(path) !== file.sha256) throw new TypeError(`Hitch bundle file changed: ${file.path}`)
  }
  if (manifest['sealed'] !== true || manifest['run_id'] !== runId || index['context_identity'] !== jsonDigest({
    context: manifest['context'], parent: manifest['parent'], harness: manifest['harness'], model: manifest['model'],
    protocol: manifest['protocol'], observation: manifest['observation'],
  })) throw new TypeError('Hitch bundle context mismatch')
  return index
}

export function readAssessment(root: string, evalId: string, reference: AssessmentRef, trial: { trialId: string; taskId: string; attempt: number; runId?: string; group?: GroupRef }): {
  directory: string; record: Record<string, unknown>; observation: EvidenceObservation
} {
  const ref = assessmentRefSchema.parse(reference)
  const directory = containedPath(root, `evals/${evalId}/assessments/${ref.id}`)
  const raw = evidenceBytes(directory, 'assessment.json'), record = object(JSON.parse(raw.toString('utf8')))
  if (sha256(raw) !== ref.digest || record['schema_version'] !== '1' || record['eval_id'] !== evalId
    || record['task_id'] !== trial.taskId || record['attempt'] !== trial.attempt) throw new TypeError('Hitch assessment identity/digest mismatch')
  if (trial.group) {
    if (record['kind'] !== 'native-phase-assessment' || record['trial_id'] !== trial.trialId
      || canonicalJson(record['run_group']) !== canonicalJson(trial.group)) throw new TypeError('Hitch native assessment identity mismatch')
  } else {
    const source = object(record['source'])
    if (record['kind'] !== 'verifier-only-assessment' || record['candidate_executes'] !== false
      || source['trial_id'] !== trial.trialId || source['run_id'] !== trial.runId) throw new TypeError('Hitch regrade source identity mismatch')
    verifyBundle(root, runIdSchema.parse(trial.runId), digestSchema.parse(source['bundle_index_digest']))
    if (record['runtime_repair'] !== undefined) {
      const repair = object(record['runtime_repair'])
      if (repair['schema_version'] !== '1' || repair['kind'] !== 'verifier-environment-runtime-repair'
        || repair['source_runtime_id'] !== source['controller_runtime_id'] || repair['replacement_runtime_id'] !== record['controller_runtime_id']
        || jsonDigest(repair) !== jsonDigest(evidenceJson(directory, 'evidence/runtime-repair.json'))) throw new TypeError('Hitch regrade runtime repair mismatch')
    } else if (source['controller_runtime_id'] !== undefined && source['controller_runtime_id'] !== record['controller_runtime_id']) throw new TypeError('Hitch regrade runtime changed without provenance')
  }
  if (evidenceTreeDigest(containedPath(directory, 'evidence')) !== digestSchema.parse(record['evidence_digest'])) throw new TypeError('Hitch assessment evidence changed')
  return { directory, record, observation: observationSchema.parse(record['observation']) }
}

const phaseSchema = z.object({ phase_index: z.number().int().positive(), run_id: runIdSchema, process_status: z.enum(['succeeded', 'failed', 'timed_out', 'cancelled']), provider_session_id: z.string().min(1), bundle_digest: digestSchema, bundle_index_digest: digestSchema })
export function readPhaseGroup(root: string, evalId: string, reference: GroupRef): Record<string, unknown> & { phases: z.infer<typeof phaseSchema>[] } {
  const ref = groupRefSchema.parse(reference)
  const raw = evidenceBytes(root, `evals/${evalId}/run-groups/${ref.run_group_id}/group.json`, 8 * 1024 * 1024)
  const group = object(JSON.parse(raw.toString('utf8'))), phases = z.array(phaseSchema).min(1).max(10_000).parse(group['phases'])
  if (sha256(raw) !== ref.digest || group['schema_version'] !== '1' || group['kind'] !== 'benchmark-phase-group'
    || group['scope'] !== 'candidate-evidence-only' || group['eval_id'] !== evalId || group['run_group_id'] !== ref.run_group_id
    || !Number.isFinite(Date.parse(String(group['created_at']))) || new Set(phases.map(p => p.run_id)).size !== phases.length
    || new Set(phases.map(p => p.provider_session_id)).size !== phases.length) throw new TypeError('Hitch phase group identity/digest mismatch')
  let previous = -Infinity
  for (const [index, phase] of phases.entries()) {
    const bundle = verifyBundle(root, phase.run_id, phase.bundle_index_digest)
    const directory = containedPath(root, `runs/${phase.run_id}`), manifest = evidenceJson(directory, 'manifest.json')
    const context = object(manifest['context']), parent = object(manifest['parent'])
    if (phase.phase_index !== index + 1 || bundle['bundle_digest'] !== phase.bundle_digest
      || context['kind'] !== 'benchmark_phase' || context['phase_index'] !== phase.phase_index || context['run_group_id'] !== ref.run_group_id
      || manifest['status'] !== phase.process_status || parent['kind'] !== 'eval' || parent['eval_id'] !== evalId
      || parent['trial_id'] !== group['trial_id'] || parent['attempt'] !== group['attempt']
      || ['benchmark_id', 'benchmark_revision', 'task_id', 'task_digest', 'verifier_identity'].some(k => context[k] !== group[k])
      || ['harness', 'model'].some(k => canonicalJson(manifest[k]) !== canonicalJson(group[k]))) throw new TypeError('Hitch phase run identity mismatch')
    const trajectory = evidenceJson(directory, z.string().parse(manifest['trajectory_ref']))
    if (trajectory['run_id'] !== phase.run_id || trajectory['provider_session_id'] !== phase.provider_session_id) throw new TypeError('Hitch phase session mismatch')
    const result = evidenceJson(directory, z.string().parse(manifest['result_ref']))
    const started = Date.parse(String(result['started_at'])), completed = Date.parse(String(result['completed_at']))
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || started < previous) throw new TypeError('Hitch phase execution intervals overlap')
    previous = completed
  }
  return { ...group, phases }
}

const processSchema = z.object({ schema_version: z.literal('1'), metric: z.string().min(1), score: z.number().finite(), detail_status: z.enum(['components', 'aggregate-only']),
  passed: z.number().int().nonnegative().optional(), total: z.number().int().nonnegative().optional(), excluded: z.number().int().nonnegative().optional(),
  components: z.array(z.object({ id: z.string().min(1), category: z.string().min(1), status: z.enum(['passed', 'failed', 'excluded']), weight: z.number().finite().positive(), code: z.string().optional() })).optional(),
})
const feedbackSchema = z.object({ schema_version: z.literal('1'), items: z.array(z.object({ code: z.string().min(1), severity: z.enum(['info', 'warning', 'error']), message: z.string().max(16384), component_ids: z.array(z.string()).optional() })) })
export type VerifierEvidence = { scores: VerifierScores; process?: z.infer<typeof processSchema>; feedback?: z.infer<typeof feedbackSchema> }

/** Missing process metrics remain absent; legacy reward-only results remain readable. */
export function readVerifierEvidence(directory: string, resultRef: string | undefined, reward: number, declared?: VerifierScores): VerifierEvidence {
  const fallback: VerifierEvidence = { scores: { total_score: reward, normalization: 'legacy-reward' } }
  if (!resultRef || !existsSync(join(directory, resultRef))) {
    if (declared) throw new TypeError('Hitch score channels have no verifier result')
    return fallback
  }
  const result = evidenceJson(directory, resultRef), rewards = result['rewards']
  if (rewards === undefined) { if (declared) throw new TypeError('Hitch verifier scores missing'); return fallback }
  const raw = object(rewards), total = raw['total_score'] ?? raw['reward']
  if (typeof total !== 'number' || !Number.isFinite(total)) { if (declared) throw new TypeError('Invalid Hitch score'); return fallback }
  if (Math.abs(total - reward) > 1e-12 || (raw['reward'] !== undefined && raw['reward'] !== total)) throw new TypeError('Hitch verifier reward mismatch')
  const scores = scoresSchema.parse({ total_score: total, ...(raw['process_score'] === undefined ? {} : { process_score: raw['process_score'] }), normalization: raw['total_score'] === undefined ? 'legacy-reward' : 'standard' })
  if (declared && canonicalJson(scores) !== canonicalJson(declared)) throw new TypeError('Hitch score channels mismatch')
  const verifierDirectory = resultRef.slice(0, resultRef.lastIndexOf('/') + 1)
  const processRef = `${verifierDirectory}process.json`, feedbackRef = `${verifierDirectory}feedback.json`
  const process = existsSync(join(directory, processRef)) ? processSchema.parse(JSON.parse(evidenceBytes(directory, processRef, 4 * 1024 * 1024).toString('utf8'))) : undefined
  const feedback = existsSync(join(directory, feedbackRef)) ? feedbackSchema.parse(JSON.parse(evidenceBytes(directory, feedbackRef, 1024 * 1024).toString('utf8'))) : undefined
  if ((scores.process_score !== undefined) !== (process !== undefined) || scores.normalization === 'legacy-reward' && (process || feedback)
    || process && Math.abs(process.score - (scores.process_score ?? NaN)) > 1e-12) throw new TypeError('Hitch process score evidence mismatch')
  if (process?.detail_status === 'components') {
    const components = process.components
    if (!components || new Set(components.map(c => c.id)).size !== components.length
      || process.passed !== components.filter(c => c.status === 'passed').length || process.total !== components.filter(c => c.status !== 'excluded').length
      || process.excluded !== components.filter(c => c.status === 'excluded').length) throw new TypeError('Hitch process component counts mismatch')
    const denominator = components.filter(c => c.status !== 'excluded').reduce((s, c) => s + c.weight, 0)
    const numerator = components.filter(c => c.status === 'passed').reduce((s, c) => s + c.weight, 0)
    if (Math.abs(process.score - (denominator ? numerator / denominator : 0)) > 1e-12) throw new TypeError('Hitch process weights mismatch')
  } else if (process && [process.components, process.passed, process.total, process.excluded].some(v => v !== undefined)) throw new TypeError('Aggregate-only process has components')
  if (feedback?.items.some(item => item.component_ids?.some(id => !process?.components?.some(c => c.id === id)))) throw new TypeError('Hitch feedback references unknown component')
  return { scores, ...(process ? { process } : {}), ...(feedback ? { feedback } : {}) }
}
