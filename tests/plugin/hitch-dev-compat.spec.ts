import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { HitchRefinementEvidenceProvider } from '../../src/hitch-provider.ts'
import { combinationScores } from '../../src/client/benchmark-dashboard.ts'
import { VerifierEvidenceView } from '../../src/client/VerifierEvidenceView.tsx'
import { en } from '../../src/client/locales.ts'
import type { RefinementEvaluationRef, HitchRunId, RefinementEvaluationView, RefinementIterationId } from '../../src/types.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const hash = (bytes: string | Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = (value: unknown) => hash(canonical(value))
async function json(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value)}\n`) }
async function read(path: string) { return JSON.parse(await readFile(path, 'utf8')) }
async function tree(directory: string): Promise<string> {
  const files: unknown[] = []
  async function visit(ref: string) {
    const path = join(directory, ref), stat = await lstat(path)
    if (stat.isDirectory()) { files.push({ path: ref, type: 'directory' }); for (const name of (await readdir(path)).sort()) await visit(ref ? `${ref}/${name}` : name) }
    else files.push({ path: ref, bytes: stat.size, mode: stat.mode & 0o777, sha256: hash(await readFile(path)) })
  }
  await visit(''); return digest(files)
}
async function bundle(directory: string) {
  const m = await read(join(directory, 'manifest.json'))
  if (m.context.kind !== 'benchmark_phase') {
    const rewardFile = join(directory, 'verifier/result.json')
    const rewards = m.observation.status === 'valid' ? (await read(rewardFile)).rewards : undefined
    await json(join(directory, 'eval/publication.json'), {
      schema_version: '1', eval_id: m.parent.eval_id, mode: 'settle', created_at: '2026-09-05T00:00:00Z',
      trial: { trial_id: m.parent.trial_id, run_id: m.run_id, task_id: m.context.task_id, attempt: m.parent.attempt,
        observation_status: m.observation.status, reward: m.observation.reward, invalid_reason: m.observation.invalid_reason,
        verifier_result_ref: m.observation.verifier_result_ref,
        ...(rewards?.total_score === undefined ? {} : { scores: { total_score: rewards.total_score,
          ...(rewards.process_score === undefined ? {} : { process_score: rewards.process_score }), normalization: 'standard' } }),
      },
    })
  }
  const files: { role: string; path: string; size: number; sha256: string }[] = []
  async function visit(ref: string) {
    for (const name of (await readdir(join(directory, ref))).sort()) {
      if (name === 'bundle.index.json') continue
      const path = ref ? `${ref}/${name}` : name, stat = await lstat(join(directory, path))
      if (stat.isDirectory()) await visit(path)
      else files.push({ role: path === 'manifest.json' ? 'manifest' : path === 'result.json' ? 'result'
        : path === 'eval/publication.json' ? 'eval-publication' : path.startsWith('verifier/') ? 'verifier-evidence'
        : path === 'trajectory.ref.json' || path.startsWith('trajectory/') ? 'trajectory' : 'diagnostic',
        path, size: stat.size, sha256: hash(await readFile(join(directory, path))) })
    }
  }
  await visit('')
  files.sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
  const identity = { schema_version: '1', run_id: m.run_id, sealed: true,
    context_identity: digest({ context: m.context, parent: m.parent, harness: m.harness, model: m.model, protocol: m.protocol, ...(m.observation ? { observation: m.observation } : {}) }), files, provenance: {} }
  const index = { ...identity, bundle_digest: digest(identity), created_at: '2026-09-05T00:00:00Z' }
  await json(join(directory, 'bundle.index.json'), index); return index
}

const evalId = `eval_${'a'.repeat(32)}`
const runId = (n: number) => `run_${n.toString(16).padStart(32, '0')}` as HitchRunId
const groupId = `run_group_${'b'.repeat(32)}`
const assessmentId = `assessment_${'c'.repeat(32)}`
const ref: RefinementEvaluationRef = { providerId: 'hitch', evalId: evalId as never, candidateId: 'candidate' as never, requestedModelId: 'model', benchmarkId: 'bench', benchmarkRevision: 'revision' }
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'rear-dev-contract-')); roots.push(root)
  return { root, provider: new HitchRefinementEvidenceProvider({ root, id: 'hitch', watchDebounceMs: 5 }) }
}
async function makeRun(root: string, n: number, phase = false, reward: number | null = 0) {
  const id = runId(n), directory = join(root, 'runs', id)
  const content = [
    { type: 'session', version: 0, id: `session-${n}`, createdAt: n * 1000 },
    { type: 'turn/start', seq: 0, time: n * 1000, data: { turn: 1 } },
    { type: 'assistant/message', seq: 1, time: n * 1000 + 1, data: { message: { content: [{ type: 'text', text: 'done' }] } } },
    { type: 'turn/end', seq: 2, time: n * 1000 + 2, data: { turn: 1 } },
  ].map(v => JSON.stringify(v)).join('\n') + '\n'
  await mkdir(join(directory, 'trajectory'), { recursive: true }); await writeFile(join(directory, 'trajectory/session.jsonl'), content)
  await json(join(directory, 'trajectory.ref.json'), { schema_version: '2', run_id: id, provider_session_id: `provider-${n}`, files: [{ role: 'canonical_session', path: 'trajectory/session.jsonl', media_type: 'application/x-ndjson', bytes: Buffer.byteLength(content), sha256: hash(content) }] })
  const context = { kind: phase ? 'benchmark_phase' : 'benchmark_task', benchmark_id: 'bench', benchmark_revision: 'revision', task_id: 'task', task_digest: 'task-digest', verifier_identity: 'verifier', ...(phase ? { run_group_id: groupId, phase_index: n } : {}) }
  const observation = reward === null ? { status: 'invalid', invalid_reason: 'verifier_infrastructure_failure' } : { status: 'valid', reward, verifier_result_ref: 'verifier/result.json' }
  const manifest = { schema_version: '1', run_id: id, sealed: true, status: 'succeeded', context,
    parent: { kind: 'eval', eval_id: evalId, trial_id: 'trial', attempt: 1 }, harness: { harness_id: 'harness', requested_ref: 'harness', revision_identity: 'revision-harness' },
    model: { requested_id: 'model', effective_id: 'model-snapshot', provider: 'test', identity_resolved: true }, protocol: { timeout_ms: 1000 - n, workspace_mode: 'shared' },
    ...(phase ? {} : { observation }), trajectory_ref: 'trajectory.ref.json', result_ref: 'result.json' }
  await json(join(directory, 'manifest.json'), manifest)
  await json(join(directory, 'result.json'), { started_at: new Date(n * 1000).toISOString(), completed_at: new Date(n * 1000 + 10).toISOString() })
  if (reward !== null) await json(join(directory, 'verifier/result.json'), { rewards: { reward } })
  return { id, directory, manifest, index: await bundle(directory) }
}
async function publish(root: string, trials: unknown[], progress = false) {
  for (const value of trials) {
    const current = value as { run_group?: unknown; assessment?: { id: string } }
    if (current.run_group && current.assessment) await json(join(root, 'evals', evalId, 'assessments', current.assessment.id, 'eval/publication.json'), {
      schema_version: '1', eval_id: evalId, mode: 'settle', trial: current, created_at: '2026-09-05T00:00:00Z',
    })
  }
  const data = { schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'revision', status: progress ? 'running' : 'succeeded', trials }
  await json(join(root, 'evals', evalId, progress ? 'progress.json' : 'result.json'), progress ? { ...data, generation: 1, planned_tasks: 1, planned_trials: 1, summary: { settled_trials: 1, valid_trials: 1, invalid_trials: 0 }, started_at: '2026-09-05T00:00:00Z', updated_at: '2026-09-05T00:01:00Z' } : data)
}
const trial = (n = 1) => ({ trial_id: 'trial', task_id: 'task', attempt: 1, run_id: runId(n), observation_status: 'valid', reward: 0, verifier_result_ref: 'verifier/result.json' })
async function assessment(root: string, record: Record<string, unknown>) {
  const directory = join(root, 'evals', evalId, 'assessments', assessmentId)
  const scores = record['scores'] as { process_score?: number } | undefined
  await json(join(directory, 'evidence/verifier/result.json'), { rewards: { reward: 0, ...(scores ? { total_score: 0 } : {}),
    ...(scores?.process_score === undefined ? {} : { process_score: scores.process_score }) } })
  if (scores?.process_score !== undefined) await json(join(directory, 'evidence/verifier/process.json'), {
    schema_version: '1', metric: 'partial_credit', score: scores.process_score, detail_status: 'aggregate-only',
  })
  await json(join(directory, 'assessment.json'), { ...record, schema_version: '1', eval_id: evalId, task_id: 'task', attempt: 1, evidence_digest: await tree(join(directory, 'evidence')) })
  return { directory, reference: { id: assessmentId, digest: hash(await readFile(join(directory, 'assessment.json'))) } }
}

describe('Hitch dev evidence contracts', () => {
  it('reads a regraded observation and preserves the original canonical run', async () => {
    const h = await harness(), run = await makeRun(h.root, 1, false, null)
    const { bundle_digest: _digest, created_at, ...source } = run.index
    const identity = { ...source, environment: { provider: 'local-docker', worker_id: 'worker-original', images: [] } }
    const index = { ...identity, bundle_digest: digest(identity), created_at }
    await json(join(run.directory, 'bundle.index.json'), index)
    const a = await assessment(h.root, { kind: 'verifier-only-assessment', candidate_executes: false, source: { run_id: run.id, trial_id: 'trial', bundle_index_digest: digest(index) }, observation: { status: 'valid', reward: 0, verifier_result_ref: 'evidence/verifier/result.json' } })
    await publish(h.root, [{ ...trial(), assessment: a.reference, verifier_result_ref: 'evidence/verifier/result.json' }])
    expect(await h.provider.evaluation(ref)).toMatchObject({ diagnostics: [], runs: [{ id: run.id, observation: { state: 'valid', reward: 0 },
      executionEvidence: { provider: 'local-docker', workerId: 'worker-original' }, trajectory: { availability: 'available' } }] })
    expect((await h.provider.trajectory({ evalRef: ref, runId: run.id })).records).toHaveLength(3)
    await writeFile(join(a.directory, 'evidence/verifier/result.json'), '{}')
    expect(await h.provider.evaluation(ref)).toMatchObject({ runs: [], diagnostics: [{ message: expect.stringContaining('assessment evidence changed') }] })
  })

  it('does not trust a replaced source run bundle or a forged assessment identity', async () => {
    const h = await harness(), run = await makeRun(h.root, 1, false, null)
    const a = await assessment(h.root, { kind: 'verifier-only-assessment', candidate_executes: false, source: { run_id: run.id, trial_id: 'trial', bundle_index_digest: digest(run.index) }, observation: { status: 'valid', reward: 0 } })
    await publish(h.root, [{ ...trial(), assessment: a.reference, verifier_result_ref: undefined }])
    await writeFile(join(run.directory, 'result.json'), '{}')
    expect((await h.provider.evaluation(ref)).diagnostics[0]?.message).toContain('bundle file changed')
    await publish(h.root, [{ ...trial(), assessment: { ...a.reference, id: '../escape' } }])
    expect((await h.provider.evaluation(ref)).status).toBe('corrupt')
  })

  it('loads all sealed phases, scores the trial once, and rejects incomplete groups', async () => {
    const h = await harness(), one = await makeRun(h.root, 1, true), two = await makeRun(h.root, 2, true)
    const { kind: _kind, phase_index: _index, ...context } = one.manifest.context
    const group = { ...context, schema_version: '1', kind: 'benchmark-phase-group', scope: 'candidate-evidence-only', eval_id: evalId, trial_id: 'trial', attempt: 1,
      harness: one.manifest.harness, model: one.manifest.model, created_at: '2026-09-05T00:00:00Z', phases: [one, two].map((r, i) => ({ phase_index: i + 1, run_id: r.id, process_status: 'succeeded', provider_session_id: `provider-${i + 1}`, bundle_digest: r.index.bundle_digest, bundle_index_digest: digest(r.index) })) }
    const groupPath = join(h.root, 'evals', evalId, 'run-groups', groupId, 'group.json'); await json(groupPath, group)
    const groupRef = { run_group_id: groupId, digest: hash(await readFile(groupPath)) }
    const scoreChannels = { total_score: 0, process_score: 0.5, normalization: 'standard' }
    const a = await assessment(h.root, { ...context, kind: 'native-phase-assessment', trial_id: 'trial', run_group: groupRef, scores: scoreChannels, observation: { status: 'valid', reward: 0, verifier_result_ref: 'evidence/verifier/result.json' } })
    const nativeTrial = { ...trial(), run_id: undefined, run_group: groupRef, assessment: a.reference, scores: scoreChannels, verifier_result_ref: 'evidence/verifier/result.json' }
    await publish(h.root, [nativeTrial], true)
    const projection = await h.provider.evaluation({ ...ref, conditionId: 'same-policy' })
    expect(projection).toMatchObject({ status: 'running', diagnostics: [], runs: [{ phase: { index: 1, count: 2 },
      verifier: { scores: scoreChannels, process: { score: 0.5 } } }, { phase: { index: 2, count: 2 } }] })
    const scores = combinationScores('iteration' as RefinementIterationId, { evaluations: [projection] } as unknown as RefinementEvaluationView)
    expect(scores).toMatchObject([{ mean: 0, taskCount: 1, runCount: 2, provisional: true }])
    expect((await h.provider.trajectory({ evalRef: ref, runId: two.id })).runId).toBe(two.id)
    const receiptPath = join(a.directory, 'eval/publication.json'), receipt = await read(receiptPath)
    await json(receiptPath, { ...receipt, trial: { ...receipt.trial, reward: 1 } })
    expect((await h.provider.evaluation(ref)).diagnostics[0]?.message).toContain('assessment publication trial mismatch')
    await json(receiptPath, receipt)
    await publish(h.root, [nativeTrial])
    expect((await h.provider.evaluation(ref)).status).toBe('succeeded')
    const assessmentPath = join(a.directory, 'assessment.json'), original = await readFile(assessmentPath)
    await json(assessmentPath, { ...JSON.parse(original.toString()), scores: { ...scoreChannels, total_score: 1 } })
    const inconsistent = { ...nativeTrial, assessment: { ...a.reference, digest: hash(await readFile(assessmentPath)) } }
    await publish(h.root, [inconsistent], true); await publish(h.root, [inconsistent])
    expect((await h.provider.evaluation(ref)).diagnostics[0]?.message).toContain('native assessment score channels mismatch')
    await writeFile(assessmentPath, original)
    await publish(h.root, [nativeTrial], true); await publish(h.root, [nativeTrial])
    await writeFile(join(two.directory, 'trajectory/session.jsonl'), '{}')
    expect(await h.provider.evaluation(ref)).toMatchObject({ runs: [], diagnostics: [{ code: 'corrupt-run-link' }] })
  })

  it('preserves process score zero, validates components, and renders feedback', async () => {
    const h = await harness(), run = await makeRun(h.root, 1)
    const scores = { total_score: 0, process_score: 0, normalization: 'standard' }
    await json(join(run.directory, 'verifier/result.json'), { rewards: { reward: 0, total_score: 0, process_score: 0 } })
    await json(join(run.directory, 'verifier/process.json'), { schema_version: '1', metric: 'partial_credit', score: 0, detail_status: 'components', passed: 0, total: 1, excluded: 0, components: [{ id: 'check', category: 'output', status: 'failed', weight: 1 }] })
    await json(join(run.directory, 'verifier/feedback.json'), { schema_version: '1', items: [{ code: 'missing', severity: 'warning', message: 'Required output is missing', component_ids: ['check'] }] })
    await bundle(run.directory); await publish(h.root, [{ ...trial(), scores }])
    const projection = await h.provider.evaluation(ref)
    expect(projection.runs[0]?.verifier).toMatchObject({ scores, process: { total: 1 }, feedback: { items: [{ code: 'missing' }] } })
    const html = renderToStaticMarkup(createElement(VerifierEvidenceView, { run: projection.runs[0]!, t: key => en[key] }))
    expect(html).toContain('Process score'); expect(html).toContain('Required output is missing')
    await publish(h.root, [{ ...trial(), scores: { ...scores, process_score: 1 } }])
    expect((await h.provider.evaluation(ref)).diagnostics[0]?.message).toContain('publication trial mismatch')
  })

  it('does not invent a process score for reward-only TB', async () => {
    const h = await harness(); await makeRun(h.root, 1); await publish(h.root, [trial()])
    const value = (await h.provider.evaluation(ref)).runs[0]!
    expect(value.verifier?.scores).toEqual({ total_score: 0, normalization: 'legacy-reward' })
    expect(renderToStaticMarkup(createElement(VerifierEvidenceView, { run: value, t: key => en[key] }))).not.toContain('Process score')
  })

  it('rejects symlinked assessment files and result/progress assessment disagreement', async () => {
    const h = await harness(), run = await makeRun(h.root, 1, false, null)
    const a = await assessment(h.root, { kind: 'verifier-only-assessment', candidate_executes: false, source: { run_id: run.id, trial_id: 'trial', bundle_index_digest: digest(run.index) }, observation: { status: 'valid', reward: 0 } })
    const current = { ...trial(), verifier_result_ref: undefined, assessment: a.reference }
    await publish(h.root, [current], true); await publish(h.root, [{ ...current, assessment: { ...a.reference, digest: hash('different') } }])
    expect((await h.provider.evaluation(ref)).status).toBe('corrupt')
    await publish(h.root, [current]); const file = join(a.directory, 'assessment.json'); const outside = join(h.root, 'outside.json')
    await writeFile(outside, await readFile(file)); await rm(file); await symlink(outside, file)
    expect((await h.provider.evaluation(ref)).runs).toEqual([])
  })
})
