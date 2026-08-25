import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import RefinementRuntime from '../../src/runtime.ts'
import type { HitchRunId, RefinementId, RefinementIterationId } from '../../src/types.ts'

interface Harness {
  readonly ctx: Context
  readonly root: string
  readonly sessionId: ReturnType<typeof SessionId>
  readonly evolutionId: RefinementId
  readonly roundId: RefinementIterationId
  readonly candidateRunId: HitchRunId
}

const harnesses: Harness[] = []

afterEach(async () => {
  const cleanup = harnesses.splice(0)
  await Promise.all(cleanup.map(({ ctx }) => ctx.fiber.dispose()))
  await Promise.all([...new Set(cleanup.map(({ root }) => root))]
    .map(root => rm(root, { recursive: true, force: true })))
})

async function json(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function digest(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`
}

function canonical(runId: string): string {
  const now = 1_700_000_000_000
  return [
    { type: 'session', version: 0, id: `session-${runId}`, createdAt: now },
    { type: 'turn/start', seq: 0, time: now, data: { turn: 1 } },
    { type: 'assistant/message', seq: 1, time: now + 1, data: { message: { content: [{ type: 'text', text: 'done' }] } } },
    { type: 'turn/end', seq: 2, time: now + 2, data: { turn: 1 } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n'
}

async function hitchEvaluation(
  root: string,
  evalId: string,
  runId: string,
  trialId: string,
  harnessId: string,
  reward: number,
): Promise<void> {
  const runRoot = join(root, 'runs', runId)
  const content = canonical(runId)
  const trajectoryPath = 'trajectory/canonical/session.jsonl'
  await mkdir(join(runRoot, 'trajectory/canonical'), { recursive: true })
  await writeFile(join(runRoot, trajectoryPath), content, 'utf8')
  await json(join(runRoot, 'trajectory.ref.json'), {
    schema_version: '2',
    run_id: runId,
    files: [{
      role: 'canonical_session', path: trajectoryPath, media_type: 'application/x-ndjson',
      sha256: digest(content), bytes: Buffer.byteLength(content),
    }],
  })
  await json(join(runRoot, 'manifest.json'), {
    schema_version: '1',
    run_id: runId,
    context: {
      kind: 'benchmark_task', benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1',
      task_id: 'task-1', task_digest: 'task-digest', verifier_identity: 'verifier-v1',
    },
    parent: { kind: 'eval', eval_id: evalId, trial_id: trialId, attempt: 1 },
    status: 'succeeded',
    harness: { requested_ref: harnessId, harness_id: harnessId, revision_identity: `revision-${harnessId}` },
    model: { requested_id: 'deepseek-chat', provider: 'test', effective_id: 'model-snapshot', identity_resolved: true },
    protocol: { timeout_ms: 1_000 },
    observation: { status: 'valid', reward },
    trajectory_ref: 'trajectory.ref.json',
  })
  await json(join(root, 'evals', evalId, 'result.json'), {
    schema_version: '1', eval_id: evalId,
    benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1', status: 'succeeded',
    trials: [{
      trial_id: trialId, run_id: runId, task_id: 'task-1', attempt: 1,
      observation_status: 'valid', reward,
    }],
  })
}

function evidence(evalId: string, runId: string, trialId: string, commit: string, reward: number) {
  return {
    provider: 'hitch-cli', conditionId: 'condition-1', effectiveConfigDigest: 'config-1',
    evalId, dataset: 'seed', requestedCommit: commit, actualCommit: commit,
    revisionIdentity: `revision-${commit}`, primaryReward: reward,
    summary: { total: 1, passed: reward > 0 ? 1 : 0, failed: reward > 0 ? 0 : 1, score: reward },
    trials: [{
      taskName: 'task-1', trialName: trialId, runId, attempt: 1,
      status: 'completed', rewards: { reward },
    }],
  }
}

async function harness(forgedCandidateRun = false): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'rear-gear-runtime-'))
  const gearRoot = join(root, 'gear')
  const hitchRoot = join(root, 'hitch')
  await mkdir(gearRoot, { recursive: true })
  await mkdir(hitchRoot, { recursive: true })
  const evolution = 'evolution-1'
  const round = 'round-1'
  const baselineEval = `eval_${'1'.repeat(32)}`
  const candidateEval = `eval_${'2'.repeat(32)}`
  const baselineRun = `run_${'1'.repeat(32)}`
  const candidateRun = `run_${'2'.repeat(32)}`
  const baselineCommit = 'a'.repeat(40)
  const candidateCommit = 'b'.repeat(40)
  await hitchEvaluation(hitchRoot, baselineEval, baselineRun, 'trial-baseline', 'baseline', 0)
  await hitchEvaluation(hitchRoot, candidateEval, candidateRun, 'trial-candidate', 'candidate', 1)
  const createdAt = '2026-08-25T00:00:00.000Z'
  const updatedAt = '2026-08-25T00:01:00.000Z'
  await json(join(gearRoot, 'registry.json'), {
    schemaVersion: 1,
    evolutions: [{ evolutionId: evolution, name: 'Improve tool safety', status: 'active', createdAt, updatedAt }],
  })
  await json(join(gearRoot, 'evolutions', evolution, 'rounds', `${round}.json`), {
    evolutionId: evolution,
    roundId: round,
    batchId: 'batch-1',
    roundIndex: 1,
    roundCount: 1,
    status: 'accepted',
    createdAt,
    updatedAt,
    targetHarnessRef: baselineCommit,
    seedTaskRef: 'seed',
    plan: {
      seed: { model: 'deepseek-chat' },
      heldOut: { model: 'deepseek-chat' },
    },
    parentAllocations: [{
      candidateId: 'candidate-1', parentCandidateId: 'initial-baseline', parentHarnessRef: baselineCommit,
    }],
    parentBaselines: [{
      parentCandidateId: 'initial-baseline', parentHarnessRef: baselineCommit,
      evidence: evidence(baselineEval, baselineRun, 'trial-baseline', baselineCommit, 0),
    }],
    candidatePool: [{
      candidateId: 'candidate-1', parentHarnessRef: baselineCommit,
      parentCandidateIds: ['initial-baseline'], status: 'selected',
      sealedVersion: { commitOid: candidateCommit },
      seedEvaluation: evidence(
        candidateEval,
        forgedCandidateRun ? `run_${'f'.repeat(32)}` : candidateRun,
        'trial-candidate',
        candidateCommit,
        1,
      ),
    }],
    promotionCandidateId: 'candidate-1',
    promotedCandidateId: 'candidate-1',
  })
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sessionId = SessionId('rear-session')
  const sessions = ctx.get('sessions') as SessionStore
  sessions.create(sessionId, { meta: { createdAt: 42, cwd: '/fixture' } })
  await ctx.plugin(RefinementRuntime, {
    gear: { root: gearRoot, watchDebounceMs: 5 },
    hitch: { id: 'hitch', root: hitchRoot, watchDebounceMs: 5 },
    trajectoryResponseMaxBytes: 65_536,
    providerEvidencePageMaxBytes: 4_096,
  })
  const value: Harness = {
    ctx,
    root,
    sessionId,
    evolutionId: `gear-evolution:${evolution}` as RefinementId,
    roundId: `gear-round:${round}` as RefinementIterationId,
    candidateRunId: candidateRun as HitchRunId,
  }
  harnesses.push(value)
  return value
}

describe('Gear-backed RefinementRuntime', () => {
  it('exposes no start or cancel control-plane methods', async () => {
    const value = await harness()
    expect('start' in value.ctx.refinements).toBe(false)
    expect('cancel' in value.ctx.refinements).toBe(false)
  })

  it('projects Gear experiments and resolves their exact Hitch trajectory_ref', async () => {
    const value = await harness()
    const listed = value.ctx.refinements.list({ sessionId: value.sessionId })
    expect(listed).toMatchObject({
      ok: true,
      value: { records: [{ id: value.evolutionId, status: 'completed', iterationCount: 1 }] },
    })
    const detail = value.ctx.refinements.get({ sessionId: value.sessionId, refinementId: value.evolutionId })
    if (!detail.ok) throw new Error(detail.error.message)
    expect(detail.value).toMatchObject({
      objective: 'Improve tool safety',
      driver: { id: 'gear', operationId: 'evolution-1' },
      iterations: [{ id: value.roundId, evaluationRefs: [{ benchmarkId: 'gear-benchmark' }, { benchmarkId: 'gear-benchmark' }] }],
    })
    const evaluated = await value.ctx.refinements.evaluation({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      iterationId: value.roundId,
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(evaluated).toMatchObject({ ok: true, value: { comparison: { strict: true } } })
    const trajectory = await value.ctx.refinements.trajectory({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      runId: value.candidateRunId,
    })
    expect(trajectory).toMatchObject({ ok: true, value: { runId: value.candidateRunId } })
    if (!trajectory.ok) throw new Error(trajectory.error.message)
    expect(trajectory.value.events.map(event => event.type)).toEqual([
      'turn/start', 'assistant/message', 'turn/end',
    ])
  })

  it('fails closed when a Gear run id is not a member of its Hitch eval', async () => {
    const value = await harness(true)
    expect(() => value.ctx.refinements.get({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
    })).toThrow(/run membership mismatch/u)
  })

})
