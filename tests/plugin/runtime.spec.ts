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

interface FailedHarness extends Harness {
  readonly invalidRunId: HitchRunId
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
    sealed: true,
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

type FailedTrajectory = 'canonical' | 'provider-only'

interface FailedRunFixture {
  readonly runId: string
  readonly taskName: string
  readonly trialName: string
  readonly invalidReason?: string
  readonly trajectory: FailedTrajectory
}

async function failedHitchEvaluation(
  root: string,
  evalId: string,
  harnessRef: string,
  runs: readonly FailedRunFixture[],
): Promise<void> {
  for (const run of runs) {
    const runRoot = join(root, 'runs', run.runId)
    const files: Array<Record<string, unknown>> = []
    if (run.trajectory === 'canonical') {
      const content = canonical(run.runId)
      const trajectoryPath = 'trajectory/canonical/session.jsonl'
      await mkdir(join(runRoot, 'trajectory/canonical'), { recursive: true })
      await writeFile(join(runRoot, trajectoryPath), content, 'utf8')
      files.push({
        role: 'canonical_session', path: trajectoryPath, media_type: 'application/x-ndjson',
        sha256: digest(content), bytes: Buffer.byteLength(content),
      })
    } else {
      const content = `{"provider":"failed-eval","runId":"${run.runId}"}\n`
      const trajectoryPath = 'trajectory/provider/events.jsonl'
      await mkdir(join(runRoot, 'trajectory/provider'), { recursive: true })
      await writeFile(join(runRoot, trajectoryPath), content, 'utf8')
      files.push({
        role: 'provider_events', path: trajectoryPath, media_type: 'application/x-ndjson',
        sha256: digest(content), bytes: Buffer.byteLength(content),
      })
    }
    await json(join(runRoot, 'trajectory.ref.json'), {
      schema_version: '2', run_id: run.runId, files,
    })
    const valid = run.invalidReason === undefined
    await json(join(runRoot, 'manifest.json'), {
      schema_version: '1',
      run_id: run.runId,
      context: {
        kind: 'benchmark_task', benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1',
        task_id: run.taskName, task_digest: `digest-${run.taskName}`, verifier_identity: 'verifier-v1',
      },
      parent: { kind: 'eval', eval_id: evalId, trial_id: run.trialName, attempt: 1 },
      status: valid ? 'succeeded' : 'failed',
      harness: { requested_ref: harnessRef, harness_id: harnessRef, revision_identity: 'failed-revision' },
      model: { requested_id: 'deepseek-chat', provider: 'test', effective_id: 'model-snapshot', identity_resolved: true },
      protocol: { timeout_ms: 1_000 },
      observation: valid
        ? { status: 'valid', reward: 1 }
        : { status: 'invalid', invalid_reason: run.invalidReason },
      trajectory_ref: 'trajectory.ref.json',
    })
  }
  await json(join(root, 'evals', evalId, 'result.json'), {
    schema_version: '1', eval_id: evalId,
    benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1', status: 'failed',
    trials: runs.map(run => ({
      trial_id: run.trialName, run_id: run.runId, task_id: run.taskName, attempt: 1,
      ...(run.invalidReason === undefined
        ? { observation_status: 'valid', reward: 1 }
        : { observation_status: 'invalid', invalid_reason: run.invalidReason }),
    })),
  })
}

function evidence(evalId: string, runId: string, trialId: string, commit: string, reward: number) {
  return {
    provider: 'hitch-cli', conditionId: 'condition-1', effectiveConfigDigest: 'config-1',
    evalId, dataset: 'seed', requestedCommit: commit, actualCommit: commit,
    revisionIdentity: `revision-${commit}`, completeness: 'complete', plannedTrialCount: 1, primaryReward: reward,
    summary: { total: 1, passed: reward > 0 ? 1 : 0, failed: reward > 0 ? 0 : 1, score: reward },
    trials: [{
      taskName: 'task-1', trialName: trialId, runId, attempt: 1,
      status: 'completed', rewards: { reward },
    }],
    invalidTrials: [],
  }
}

async function harness(
  forgedCandidateRun = false,
  roundStatus = 'accepted',
  repairCompleted = false,
): Promise<Harness> {
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
  await hitchEvaluation(hitchRoot, baselineEval, baselineRun, 'trial-baseline', baselineCommit, 0)
  await hitchEvaluation(hitchRoot, candidateEval, candidateRun, 'trial-candidate', candidateCommit, 1)
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
    status: roundStatus,
    createdAt,
    updatedAt,
    targetHarnessRef: baselineCommit,
    seedTaskRef: 'seed',
    heldOutRef: 'held-out',
    plan: {
      seed: { model: 'deepseek-chat', conditionId: 'condition-1' },
      heldOut: { model: 'deepseek-chat', conditionId: 'condition-held-out' },
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
      proposal: {
        rationale: 'Reduce unsafe tool behavior found in the baseline trajectories.',
        expectedOutcome: 'Keep the final user workflow intact after verification.',
      },
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
    evaluationAttempts: [{
      provider: 'hitch-cli', evalId: baselineEval, phase: 'seed-baseline',
      owner: { candidateId: 'initial-baseline', harnessRef: baselineCommit, role: 'baseline' },
      conditionId: 'condition-1', dataset: 'seed', requestedModelId: 'deepseek-chat', requestedCommit: baselineCommit,
      status: 'settled', startedAt: createdAt, completedAt: updatedAt,
    }, {
      provider: 'hitch-cli', evalId: candidateEval, phase: 'seed-candidate',
      owner: { candidateId: 'candidate-1', harnessRef: candidateCommit, role: 'candidate' },
      conditionId: 'condition-1', dataset: 'seed', requestedModelId: 'deepseek-chat', requestedCommit: candidateCommit,
      status: repairCompleted ? 'repair-completed' : 'settled', startedAt: createdAt, completedAt: updatedAt,
    }],
    ...(repairCompleted ? {
      evaluationRepairResume: { provider: 'hitch-cli', evalId: candidateEval, completedAt: updatedAt },
    } : {}),
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

async function failedHarness(
  invalidTrajectory: FailedTrajectory,
  mismatch: 'run' | 'task' | 'trial' | 'attempt' | null = null,
): Promise<FailedHarness> {
  const root = await mkdtemp(join(tmpdir(), 'rear-gear-failed-runtime-'))
  const gearRoot = join(root, 'gear')
  const hitchRoot = join(root, 'hitch')
  await mkdir(gearRoot, { recursive: true })
  await mkdir(hitchRoot, { recursive: true })
  const evolution = 'failed-evolution'
  const round = 'failed-round'
  const evalId = `eval_${'3'.repeat(32)}`
  const harnessRef = 'c'.repeat(40)
  const ownerId = `champion-${harnessRef}`
  const invalidReason = 'invalid observation: final answer is missing'
  const runs: FailedRunFixture[] = [
    { runId: `run_${'3'.repeat(32)}`, taskName: 'task-1', trialName: 'trial-1', trajectory: 'canonical' },
    { runId: `run_${'4'.repeat(32)}`, taskName: 'task-2', trialName: 'trial-2', trajectory: 'provider-only' },
    { runId: `run_${'5'.repeat(32)}`, taskName: 'task-3', trialName: 'trial-3', invalidReason, trajectory: invalidTrajectory },
  ]
  await failedHitchEvaluation(hitchRoot, evalId, harnessRef, runs)
  const createdAt = '2026-08-25T00:00:00.000Z'
  const updatedAt = '2026-08-25T00:01:00.000Z'
  await json(join(gearRoot, 'registry.json'), {
    schemaVersion: 1,
    evolutions: [{ evolutionId: evolution, name: 'Failed baseline evaluation', status: 'active', createdAt, updatedAt }],
  })
  const trials = runs.map((run, index) => ({
    taskName: mismatch === 'task' && index === 2 ? 'forged-task' : run.taskName,
    trialName: mismatch === 'trial' && index === 2 ? 'forged-trial' : run.trialName,
    runId: mismatch === 'run' && index === 2 ? `run_${'f'.repeat(32)}` : run.runId,
    attempt: mismatch === 'attempt' && index === 2 ? 2 : 1,
    status: run.invalidReason === undefined ? 'completed' : 'failed',
    ...(run.invalidReason === undefined ? {} : { invalidReason: run.invalidReason }),
  }))
  await json(join(gearRoot, 'evolutions', evolution, 'rounds', `${round}.json`), {
    evolutionId: evolution,
    roundId: round,
    batchId: 'batch-failed',
    roundIndex: 1,
    roundCount: 1,
    status: 'failed',
    createdAt,
    updatedAt,
    targetHarnessRef: harnessRef,
    seedTaskRef: 'seed',
    heldOutRef: 'held-out',
    plan: {
      seed: { model: 'deepseek-chat', conditionId: 'condition-seed' },
      heldOut: { model: 'deepseek-reasoner', conditionId: 'condition-held-out' },
    },
    candidatePool: [],
    failedEvaluations: [{
      phase: 'seed-baseline',
      owner: { candidateId: ownerId, harnessRef, role: 'baseline' },
      evidence: {
        evalId,
        provider: 'hitch-cli',
        conditionId: 'condition-seed',
        effectiveConfigDigest: 'config-seed',
        dataset: 'seed',
        requestedCommit: harnessRef,
        actualCommit: harnessRef,
        revisionIdentity: 'failed-revision',
        runSetComplete: true,
        trials,
      },
      failure: { code: 'invalid-observation', message: invalidReason },
    }],
    evaluationAttempts: [{
      provider: 'hitch-cli', evalId, phase: 'seed-baseline',
      owner: { candidateId: ownerId, harnessRef, role: 'baseline' },
      conditionId: 'condition-seed', dataset: 'seed', requestedModelId: 'deepseek-chat', requestedCommit: harnessRef,
      status: 'failed', startedAt: createdAt, completedAt: updatedAt,
      failure: { code: 'invalid-observation', message: invalidReason },
    }],
    failure: { phase: 'seed-baseline', message: 'baseline evaluation failed closed' },
  })
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const sessionId = SessionId('rear-failed-session')
  const sessions = ctx.get('sessions') as SessionStore
  sessions.create(sessionId, { meta: { createdAt: 42, cwd: '/fixture' } })
  await ctx.plugin(RefinementRuntime, {
    gear: { root: gearRoot, watchDebounceMs: 5 },
    hitch: { id: 'hitch', root: hitchRoot, watchDebounceMs: 5 },
    trajectoryResponseMaxBytes: 65_536,
    providerEvidencePageMaxBytes: 4_096,
  })
  const value: FailedHarness = {
    ctx,
    root,
    sessionId,
    evolutionId: `gear-evolution:${evolution}` as RefinementId,
    roundId: `gear-round:${round}` as RefinementIterationId,
    candidateRunId: runs[0]?.runId as HitchRunId,
    invalidRunId: runs[2]?.runId as HitchRunId,
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
      candidates: [{ id: 'gear-candidate:initial-baseline' }, {
        id: 'gear-candidate:candidate-1',
        directionSummary: 'Keep the final user workflow intact after verification.',
      }],
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

  it('projects current Gear repair-completed evidence through its durable resume intent', async () => {
    const value = await harness(false, 'repairing-evaluation', true)
    const detail = value.ctx.refinements.get({ sessionId: value.sessionId, refinementId: value.evolutionId })
    expect(detail).toMatchObject({
      ok: true,
      value: {
        status: 'running',
        activeIterationId: value.roundId,
        iterations: [{
          status: 'rerunning',
          evaluationRefs: [
            { evalId: `eval_${'1'.repeat(32)}` },
            { evalId: `eval_${'2'.repeat(32)}` },
          ],
        }],
      },
    })
    const evaluated = await value.ctx.refinements.evaluation({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      iterationId: value.roundId,
      dimension: 'harness',
      referenceRunId: null,
    })
    expect(evaluated).toMatchObject({
      ok: true,
      value: {
        evaluations: expect.arrayContaining([
          expect.objectContaining({
            ref: expect.objectContaining({ evalId: `eval_${'2'.repeat(32)}` }),
            status: 'succeeded',
          }),
        ]),
      },
    })
  })

  it('projects a rerunning Gear attempt from Hitch progress before repaired Gear evidence exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rear-gear-progress-runtime-'))
    const gearRoot = join(root, 'gear')
    const hitchRoot = join(root, 'hitch')
    await mkdir(gearRoot, { recursive: true })
    await mkdir(hitchRoot, { recursive: true })
    const evolution = 'progress-evolution'
    const round = 'progress-round'
    const evalId = `eval_${'8'.repeat(32)}`
    const runId = `run_${'8'.repeat(32)}`
    const commit = 'd'.repeat(40)
    const ownerId = `champion-${commit}`
    const createdAt = '2026-08-26T00:00:00.000Z'
    await hitchEvaluation(hitchRoot, evalId, runId, 'trial-progress', 'baseline', 1)
    await json(join(hitchRoot, 'evals', evalId, 'request.json'), {
      benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1',
    })
    const trial = {
      trial_id: 'trial-progress', run_id: runId, task_id: 'task-1', attempt: 1,
      observation_status: 'valid', reward: 1,
    }
    await json(join(hitchRoot, 'evals', evalId, 'progress.json'), {
      schema_version: '1', eval_id: evalId,
      benchmark_id: 'gear-benchmark', benchmark_revision: 'revision-1', status: 'running', generation: 1,
      planned_tasks: null, planned_trials: null, trials: [trial],
      summary: { settled_trials: 1, valid_trials: 1, invalid_trials: 0 },
      started_at: createdAt, updated_at: '2026-08-26T00:00:01.000Z',
    })
    await json(join(gearRoot, 'registry.json'), {
      schemaVersion: 1,
      evolutions: [{ evolutionId: evolution, name: 'Incremental benchmark', status: 'active', createdAt, updatedAt: createdAt }],
    })
    await json(join(gearRoot, 'evolutions', evolution, 'rounds', `${round}.json`), {
      evolutionId: evolution, roundId: round, batchId: 'batch-progress', roundIndex: 1, roundCount: 1,
      status: 'repairing-evaluation', createdAt, updatedAt: createdAt,
      targetHarnessRef: commit, seedTaskRef: 'seed', heldOutRef: 'held-out',
      plan: {
        seed: { model: 'deepseek-chat', conditionId: 'condition-seed' },
        heldOut: { model: 'deepseek-chat', conditionId: 'condition-held-out' },
      },
      candidatePool: [{
        candidateId: 'candidate-1', parentHarnessRef: commit, parentCandidateIds: [ownerId], status: 'generating',
      }],
      evaluationAttempts: [{
        provider: 'hitch-cli', evalId, phase: 'seed-baseline',
        owner: { candidateId: ownerId, harnessRef: commit, role: 'baseline' },
        conditionId: 'condition-seed', dataset: 'seed', requestedModelId: 'deepseek-chat', requestedCommit: commit,
        status: 'rerunning', startedAt: createdAt,
      }],
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const sessionId = SessionId('rear-progress-session')
    ;(ctx.get('sessions') as SessionStore).create(sessionId, { meta: { createdAt: 42, cwd: '/fixture' } })
    await ctx.plugin(RefinementRuntime, {
      gear: { root: gearRoot, watchDebounceMs: 5 },
      hitch: { id: 'hitch', root: hitchRoot, watchDebounceMs: 5 },
      trajectoryResponseMaxBytes: 65_536,
      providerEvidencePageMaxBytes: 4_096,
    })
    const value: Harness = {
      ctx, root, sessionId,
      evolutionId: `gear-evolution:${evolution}` as RefinementId,
      roundId: `gear-round:${round}` as RefinementIterationId,
      candidateRunId: runId as HitchRunId,
    }
    harnesses.push(value)

    const detail = ctx.refinements.get({ sessionId, refinementId: value.evolutionId })
    expect(detail).toMatchObject({
      ok: true,
      value: {
        status: 'running',
        baselineCandidateId: `gear-candidate:${ownerId}`,
        activeIterationId: value.roundId,
        iterations: [{
          status: 'rerunning',
          evaluationRefs: [{ evalId, candidateId: `gear-candidate:${ownerId}`, rerunning: true }],
        }],
      },
    })
    const evaluated = await ctx.refinements.evaluation({
      sessionId, refinementId: value.evolutionId, iterationId: value.roundId, dimension: 'harness', referenceRunId: null,
    })
    expect(evaluated).toMatchObject({
      ok: true,
      value: {
        evaluations: [{ status: 'rerunning', plannedTasks: null, settledTasks: 1, runs: [{ id: runId }] }],
        comparison: { strict: false, tasks: [{ status: 'pending', delta: null }] },
      },
    })
    await expect(ctx.refinements.trajectory({
      sessionId, refinementId: value.evolutionId, runId: runId as HitchRunId,
    })).resolves.toMatchObject({ ok: true, value: { runId } })
  })

  it('fails closed when a Gear run id is not a member of its Hitch eval', async () => {
    const value = await harness(true)
    expect(() => value.ctx.refinements.get({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
    })).toThrow(/run membership mismatch/u)
  })

  it('projects every run from a failed baseline evaluation and retains invalid evidence', async () => {
    const value = await failedHarness('canonical')
    const detail = value.ctx.refinements.get({ sessionId: value.sessionId, refinementId: value.evolutionId })
    if (!detail.ok) throw new Error(detail.error.message)
    expect(detail.value).toMatchObject({
      status: 'failed',
      baselineCandidateId: `gear-candidate:champion-${'c'.repeat(40)}`,
      candidates: [{
        id: `gear-candidate:champion-${'c'.repeat(40)}`,
        role: 'baseline',
        requestedHarnessRef: 'c'.repeat(40),
        revisionIdentity: 'failed-revision',
      }],
      iterations: [{
        id: value.roundId,
        status: 'failed',
        failure: { code: 'seed-baseline', message: 'baseline evaluation failed closed' },
        evaluationRefs: [{
          candidateId: `gear-candidate:champion-${'c'.repeat(40)}`,
          requestedModelId: 'deepseek-chat',
          failedEvaluation: {
            phase: 'seed-baseline',
            code: 'invalid-observation',
          },
        }],
      }],
    })
    const evaluated = await value.ctx.refinements.evaluation({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      iterationId: value.roundId,
      dimension: 'harness',
      referenceRunId: null,
    })
    if (!evaluated.ok) throw new Error(evaluated.error.message)
    expect(evaluated.value.evaluations).toHaveLength(1)
    expect(evaluated.value.evaluations[0]?.status).toBe('failed')
    expect(evaluated.value.evaluations[0]?.runs).toHaveLength(3)
    expect(evaluated.value.evaluations[0]?.runs[2]?.observation).toEqual({
      state: 'invalid',
      reason: 'invalid observation: final answer is missing',
    })
    expect(evaluated.value.comparison.strict).toBe(false)
    const trajectory = await value.ctx.refinements.trajectory({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      runId: value.invalidRunId,
    })
    expect(trajectory).toMatchObject({ ok: true, value: { runId: value.invalidRunId } })
  })

  it('reads provider-only evidence from an invalid run in a failed evaluation', async () => {
    const value = await failedHarness('provider-only')
    const evaluated = await value.ctx.refinements.evaluation({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      iterationId: value.roundId,
      dimension: 'harness',
      referenceRunId: null,
    })
    if (!evaluated.ok) throw new Error(evaluated.error.message)
    expect(evaluated.value.evaluations[0]?.runs[2]).toMatchObject({
      id: value.invalidRunId,
      observation: { state: 'invalid', reason: 'invalid observation: final answer is missing' },
      trajectory: { availability: 'provider-only', hasCanonical: false, providerFileCount: 1 },
    })
    const evidencePage = await value.ctx.refinements.providerEvidence({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      runId: value.invalidRunId,
      fileOrdinal: 0,
      cursor: null,
    })
    expect(evidencePage).toMatchObject({
      ok: true,
      value: { runId: value.invalidRunId, content: expect.stringContaining('failed-eval') },
    })
  })

  it.each(['run', 'task', 'trial', 'attempt'] as const)(
    'fails closed when failed evaluation %s identity differs from Hitch',
    async mismatch => {
      const value = await failedHarness('canonical', mismatch)
      expect(() => value.ctx.refinements.get({
        sessionId: value.sessionId,
        refinementId: value.evolutionId,
      })).toThrow(mismatch === 'run' ? /run membership mismatch/u : new RegExp(`${mismatch} identity mismatch`, 'u'))
    },
  )

  it('keeps selection-running rounds active', async () => {
    const value = await harness(false, 'selection-running')
    const detail = value.ctx.refinements.get({ sessionId: value.sessionId, refinementId: value.evolutionId })
    expect(detail).toMatchObject({
      ok: true,
      value: { status: 'running', activeIterationId: value.roundId },
    })
  })

  it('does not expose Hitch runs that Gear did not reference', async () => {
    const value = await harness()
    const unownedEval = `eval_${'9'.repeat(32)}`
    const unownedRun = `run_${'9'.repeat(32)}` as HitchRunId
    await hitchEvaluation(join(value.root, 'hitch'), unownedEval, unownedRun, 'trial-unowned', 'unowned', 1)
    await expect(value.ctx.refinements.trajectory({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      runId: unownedRun,
    })).resolves.toMatchObject({ ok: false, error: { code: 'run-not-found' } })
    await expect(value.ctx.refinements.providerEvidence({
      sessionId: value.sessionId,
      refinementId: value.evolutionId,
      runId: unownedRun,
      fileOrdinal: 0,
      cursor: null,
    })).resolves.toMatchObject({ ok: false, error: { code: 'run-not-found' } })
  })

})
