import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  HitchEvalId,
  HitchRunId,
  RefinementCandidateId,
  RefinementEvaluationRef,
} from '../../src/types.ts'
import { HitchRefinementEvidenceProvider } from '../../src/hitch-provider.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

function digest(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function canonical(runId: string): string {
  const now = 1_700_000_000_000
  return [
    { type: 'session', version: 0, id: `session-${runId}`, createdAt: now },
    { type: 'turn/start', seq: 0, time: now, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: now + 1, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 2, time: now + 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'done' }], source: { provider: 'test', model: 'model' } }, usage: { inputTokens: 7, outputTokens: 3 } } },
    { type: 'step/end', seq: 3, time: now + 3, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 4, time: now + 4, data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n'
}

interface RunFixture {
  readonly runId: HitchRunId
  readonly candidateId: RefinementCandidateId
  readonly trialId: string
  readonly attempt: number
  readonly reward?: number
  readonly invalidReason?: string
  readonly trajectory: 'canonical' | 'provider-only' | 'missing' | 'corrupt-path'
  readonly providerContent?: string
  readonly corruptOwnership?: boolean
  readonly protocolTimeout?: number
  readonly taskId?: string
}

async function run(root: string, evalId: HitchEvalId, value: RunFixture): Promise<void> {
  const directory = join(root, 'runs', value.runId)
  await mkdir(directory, { recursive: true })
  const files: Array<Record<string, unknown>> = []
  if (value.trajectory === 'canonical') {
    const content = canonical(value.runId)
    const path = 'trajectory/canonical/session.jsonl'
    await mkdir(join(directory, 'trajectory/canonical'), { recursive: true })
    await writeFile(join(directory, path), content, 'utf8')
    files.push({ role: 'canonical_session', path, media_type: 'application/x-ndjson', sha256: digest(content), bytes: Buffer.byteLength(content) })
  } else if (value.trajectory === 'provider-only') {
    const content = value.providerContent ?? '{"native":true}\n'
    const path = 'trajectory/provider/events.jsonl'
    await mkdir(join(directory, 'trajectory/provider'), { recursive: true })
    await writeFile(join(directory, path), content, 'utf8')
    files.push({ role: 'provider_events', path, media_type: 'application/x-ndjson', sha256: digest(content), bytes: Buffer.byteLength(content) })
  } else if (value.trajectory === 'corrupt-path') {
    files.push({ role: 'canonical_session', path: '../outside', media_type: 'application/x-ndjson', sha256: `sha256:${'0'.repeat(64)}`, bytes: 1 })
  }
  if (value.trajectory !== 'missing') {
    await json(join(directory, 'trajectory.ref.json'), { schema_version: '2', run_id: value.runId, files })
  }
  const valid = value.invalidReason === undefined
  await json(join(directory, 'manifest.json'), {
    schema_version: '1',
    run_id: value.runId,
    context: {
      kind: 'benchmark_task', benchmark_id: 'bench', benchmark_revision: 'rev', task_id: value.taskId ?? 'task-1',
      task_digest: 'task-digest', verifier_identity: 'verifier',
    },
    parent: {
      kind: 'eval',
      eval_id: value.corruptOwnership ? 'eval-other' : evalId,
      trial_id: value.trialId,
      attempt: value.attempt,
    },
    status: 'succeeded',
    harness: { requested_ref: String(value.candidateId), harness_id: String(value.candidateId), revision_identity: `rev-${value.candidateId}` },
    model: { requested_id: 'model', provider: 'test', effective_id: 'model-snapshot', identity_resolved: true },
    protocol: { timeout_ms: value.protocolTimeout ?? 1_000 },
    observation: valid ? { status: 'valid', reward: value.reward } : { status: 'invalid', invalid_reason: value.invalidReason },
    ...(value.trajectory === 'missing' ? {} : { trajectory_ref: 'trajectory.ref.json' }),
  })
}

async function evaluation(root: string, evalId: HitchEvalId, fixtures: readonly RunFixture[]): Promise<void> {
  for (const fixture of fixtures) await run(root, evalId, fixture)
  await json(join(root, 'evals', evalId, 'result.json'), {
    schema_version: '1', eval_id: evalId, benchmark_id: 'bench', benchmark_revision: 'rev', status: 'succeeded',
    trials: fixtures.map(value => ({
      trial_id: value.trialId, run_id: value.runId, task_id: value.taskId ?? 'task-1', attempt: value.attempt,
      ...(value.invalidReason === undefined
        ? { observation_status: 'valid', reward: value.reward }
        : { observation_status: 'invalid', invalid_reason: value.invalidReason }),
    })),
  })
}

function ref(evalId: HitchEvalId, candidateId: RefinementCandidateId): RefinementEvaluationRef {
  return { providerId: 'hitch', evalId, candidateId, requestedModelId: 'model', benchmarkId: 'bench', benchmarkRevision: 'rev' }
}

describe('HitchRefinementEvidenceProvider', () => {
  it('preserves attempts, invalid observations, and canonical/provider-only availability', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-provider-'))
    roots.push(root)
    const evalId = 'eval_fixture' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const fixtures: RunFixture[] = [
      { runId: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HitchRunId, candidateId, trialId: 'trial-a', attempt: 1, reward: 0, trajectory: 'canonical' },
      { runId: 'run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as HitchRunId, candidateId, trialId: 'trial-b', attempt: 2, invalidReason: 'infrastructure', trajectory: 'provider-only' },
      { runId: 'run_cccccccccccccccccccccccccccccccc' as HitchRunId, candidateId, trialId: 'trial-c', attempt: 3, reward: 1, trajectory: 'missing' },
    ]
    await evaluation(root, evalId, fixtures)
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const projection = await provider.evaluation(ref(evalId, candidateId))
    expect(projection.runs.map(item => item.attempt)).toEqual([1, 2, 3])
    expect(projection.runs.map(item => item.trajectory.availability)).toEqual(['available', 'provider-only', 'missing'])
    expect(projection.runs[0]?.observation).toEqual({ state: 'valid', reward: 0 })
    expect(projection.runs[1]?.observation).toEqual({ state: 'invalid', reason: 'infrastructure' })
    const document = await provider.trajectory({ evalRef: ref(evalId, candidateId), runId: fixtures[0]?.runId as HitchRunId })
    expect(document.events).toHaveLength(5)
    const page = await provider.providerEvidence({
      evalRef: ref(evalId, candidateId),
      runId: fixtures[1]?.runId as HitchRunId,
      fileOrdinal: 0,
      cursor: null,
      maxBytes: 1_024,
    })
    expect(page.content).toContain('native')
  })

  it('marks escaped evidence paths corrupt before returning bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-corrupt-'))
    roots.push(root)
    const evalId = 'eval_corrupt' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const fixture: RunFixture = {
      runId: 'run_dddddddddddddddddddddddddddddddd' as HitchRunId,
      candidateId,
      trialId: 'trial-d',
      attempt: 1,
      reward: 1,
      trajectory: 'corrupt-path',
    }
    await evaluation(root, evalId, [fixture])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const projection = await provider.evaluation(ref(evalId, candidateId))
    expect(projection.runs[0]?.trajectory.availability).toBe('corrupt')
    expect(projection.runs[0]?.integrity).toBe('corrupt')
  })

  it('pages text evidence without splitting UTF-8 code points', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-utf8-'))
    roots.push(root)
    const evalId = 'eval_utf8' as HitchEvalId
    const candidateId = 'candidate-a' as RefinementCandidateId
    const content = '证据🧪'.repeat(80)
    const fixture: RunFixture = {
      runId: 'run_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as HitchRunId,
      candidateId,
      trialId: 'trial-e',
      attempt: 1,
      reward: 1,
      trajectory: 'provider-only',
      providerContent: content,
    }
    await evaluation(root, evalId, [fixture])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const pages: string[] = []
    let cursor: string | null = null
    do {
      const page = await provider.providerEvidence({
        evalRef: ref(evalId, candidateId),
        runId: fixture.runId,
        fileOrdinal: 0,
        cursor,
        maxBytes: 512,
      })
      pages.push(page.content)
      cursor = page.nextCursor
    } while (cursor !== null)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.join('')).toBe(content)
    expect(pages.join('')).not.toContain('�')
  })

  it('keeps running evaluations run-free and reports corrupt eval/run ownership links', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-lifecycle-'))
    roots.push(root)
    const runningId = 'eval_running' as HitchEvalId
    await mkdir(join(root, 'evals', runningId), { recursive: true })
    await json(join(root, 'evals', runningId, 'plan.json'), { tasks: [{ id: 'a' }, { id: 'b' }] })
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    await expect(provider.evaluation(ref(runningId, 'candidate-a' as RefinementCandidateId))).resolves.toMatchObject({
      status: 'running',
      plannedTasks: 2,
      settledTasks: 0,
      runs: [],
    })

    const corruptId = 'eval_corrupt_link' as HitchEvalId
    const corrupt: RunFixture = {
      runId: 'run_ffffffffffffffffffffffffffffffff' as HitchRunId,
      candidateId: 'candidate-a' as RefinementCandidateId,
      trialId: 'trial-f',
      attempt: 1,
      reward: 1,
      trajectory: 'canonical',
      corruptOwnership: true,
    }
    await evaluation(root, corruptId, [corrupt])
    const projection = await provider.evaluation(ref(corruptId, corrupt.candidateId))
    expect(projection.runs).toEqual([])
    expect(projection.diagnostics).toMatchObject([{ code: 'corrupt-run-link' }])
  })

  it('owns strict harness comparison and degrades protocol mismatches to exploratory evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-hitch-comparison-'))
    roots.push(root)
    const baselineId = 'eval_baseline' as HitchEvalId
    const candidateId = 'eval_candidate' as HitchEvalId
    const mismatchId = 'eval_mismatch' as HitchEvalId
    const baseline: RunFixture = {
      runId: 'run_11111111111111111111111111111111' as HitchRunId,
      candidateId: 'candidate-a' as RefinementCandidateId,
      trialId: 'trial-1', attempt: 1, reward: 0, trajectory: 'canonical',
    }
    const candidate: RunFixture = {
      runId: 'run_22222222222222222222222222222222' as HitchRunId,
      candidateId: 'candidate-b' as RefinementCandidateId,
      trialId: 'trial-2', attempt: 1, reward: 1, trajectory: 'canonical',
    }
    const mismatch: RunFixture = {
      runId: 'run_33333333333333333333333333333333' as HitchRunId,
      candidateId: 'candidate-c' as RefinementCandidateId,
      trialId: 'trial-3', attempt: 1, reward: 1, trajectory: 'canonical', protocolTimeout: 2_000, taskId: 'task-2',
    }
    await evaluation(root, baselineId, [baseline])
    await evaluation(root, candidateId, [candidate])
    await evaluation(root, mismatchId, [mismatch])
    const provider = new HitchRefinementEvidenceProvider({ id: 'hitch', root, watchDebounceMs: 5 })
    const strict = await provider.compare({
      refs: [ref(baselineId, baseline.candidateId), ref(candidateId, candidate.candidateId)],
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(strict.strict).toBe(true)
    expect(strict.tasks).toMatchObject([{ referenceMean: 0, candidateMean: 1, delta: 1, status: 'improved' }])

    const exploratory = await provider.compare({
      refs: [ref(baselineId, baseline.candidateId), ref(mismatchId, mismatch.candidateId)],
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(exploratory.strict).toBe(false)
    expect(exploratory.exclusions).toContainEqual({ runId: mismatch.runId, code: 'protocol-identity-mismatch' })
    expect(exploratory.exclusions).toContainEqual({ runId: mismatch.runId, code: 'benchmark-reference-missing' })
  })
})
