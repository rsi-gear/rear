import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_REGRESSION_GUARDRAIL,
  benchmarkPortfolio,
  benchmarkPortfolioCoverage,
  combinationScores,
  overviewCombinationScores,
  type BenchmarkCombinationScore,
} from '../../src/client/benchmark-dashboard.ts'
import type {
  HitchEvalId,
  HitchRunId,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementEvaluationView,
  RefinementIterationId,
  RefinementRunView,
} from '../../src/types.ts'

const iterationId = 'iteration-portfolio' as RefinementIterationId
const baselineId = 'candidate-baseline' as RefinementCandidateId
const safeId = 'candidate-safe' as RefinementCandidateId
const qualityId = 'candidate-quality' as RefinementCandidateId

function candidate(id: RefinementCandidateId, role: 'baseline' | 'candidate', createdAt: number): RefinementCandidateRecord {
  return {
    id,
    role,
    parentCandidateId: role === 'baseline' ? null : baselineId,
    requestedHarnessRef: `harness:${id}`,
    revisionIdentity: `revision:${id}`,
    label: String(id),
    createdAt,
  }
}

function score(
  candidateId: RefinementCandidateId,
  benchmarkId: string,
  mean: number,
  meanDurationMs: number,
): BenchmarkCombinationScore {
  return {
    key: `${candidateId}:${benchmarkId}`,
    iterationId,
    candidateId,
    benchmarkId,
    benchmarkRevision: '2026.08',
    harnessId: 'rear-agent',
    harnessRef: 'rear-agent@fixture',
    revision: 'git:fixture',
    modelId: 'model-fixture',
    provider: 'fixture',
    modelResolved: true,
    protocolIdentity: 'fixture-protocol',
    evaluationIds: ['eval-fixture'],
    runIds: ['run-fixture'],
    mean,
    meanDurationMs,
    taskCount: 4,
    plannedTaskCount: 4,
    runCount: 4,
    provisional: false,
  }
}

function validRun(taskId: string, reward: number, initialWorkspaceDigest: string): RefinementRunView {
  return {
    id: `run_${taskId.padEnd(32, '0')}` as HitchRunId,
    evalId: 'eval_workspace_digest' as HitchEvalId,
    candidateId: baselineId,
    trialId: `trial-${taskId}`,
    attempt: 1,
    taskKey: `task-key-${taskId}`,
    taskId,
    execution: 'succeeded',
    observation: { state: 'valid', reward },
    integrity: 'valid',
    harness: { requestedRef: 'harness', id: 'harness', revisionIdentity: 'revision' },
    model: { requestedId: 'model', provider: 'test', effectiveId: 'model-snapshot' },
    protocolIdentity: JSON.stringify({
      environment_identity: 'environment',
      initial_workspace_digest: initialWorkspaceDigest,
      timeout_ms: 1_000,
      workspace_mode: 'shared',
    }),
    trajectory: { availability: 'missing', hasCanonical: false, providerFileCount: 0 },
  }
}

describe('benchmark portfolio dashboard', () => {
  it('never promotes valid observations carried by failed Gear evaluation evidence', () => {
    const runId = 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HitchRunId
    const evaluation: RefinementEvaluationView = {
      evidenceVersion: 'failed-evidence',
      evaluations: [{
        ref: {
          providerId: 'hitch',
          evalId: 'eval_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HitchEvalId,
          candidateId: baselineId,
          requestedModelId: 'model',
          benchmarkId: 'quality',
          benchmarkRevision: '2026.08',
          failedEvaluation: {
            phase: 'seed-baseline',
            code: 'invalid-observation',
            message: 'one attempt was invalid',
          },
        },
        status: 'failed',
        plannedTasks: 1,
        settledTasks: 1,
        runs: [{
          id: runId,
          evalId: 'eval_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as HitchEvalId,
          candidateId: baselineId,
          trialId: 'trial-1',
          attempt: 1,
          taskKey: 'task-key',
          taskId: 'task-1',
          execution: 'succeeded',
          observation: { state: 'valid', reward: 1 },
          integrity: 'valid',
          harness: { requestedRef: 'harness', id: 'harness', revisionIdentity: 'revision' },
          model: { requestedId: 'model', provider: 'test', effectiveId: 'model-snapshot' },
          protocolIdentity: 'protocol',
          trajectory: { availability: 'missing', hasCanonical: false, providerFileCount: 0 },
        }],
        diagnostics: [],
      }],
      comparison: {
        strict: false,
        dimension: 'harness',
        referenceRunId: runId,
        exclusions: [],
        tasks: [],
      },
    }

    expect(combinationScores(iterationId, evaluation)).toEqual([])
  })

  it('does not split an equal-weight task mean by task-specific initial workspace digests', () => {
    const runId = 'run_build-cython-ext000000000000000' as HitchRunId
    const evaluation: RefinementEvaluationView = {
      evidenceVersion: 'workspace-digests',
      evaluations: [{
        ref: {
          providerId: 'hitch',
          evalId: 'eval_workspace_digest' as HitchEvalId,
          candidateId: baselineId,
          requestedModelId: 'model',
          benchmarkId: 'terminal-bench',
          benchmarkRevision: '2.0',
        },
        status: 'succeeded',
        plannedTasks: 5,
        settledTasks: 5,
        runs: [
          validRun('build-cython-ext', 1, 'empty'),
          validRun('chess-best-move', 1, 'chess'),
          validRun('configure-git-webserver', 0, 'empty'),
          validRun('fix-code-vulnerability', 1, 'security'),
          validRun('polyglot-c-py', 0, 'empty'),
        ],
        diagnostics: [],
      }],
      comparison: {
        strict: false,
        dimension: 'harness',
        referenceRunId: runId,
        exclusions: [],
        tasks: [],
      },
    }

    const scores = combinationScores(iterationId, evaluation)
    expect(scores).toHaveLength(1)
    expect(scores[0]).toMatchObject({ taskCount: 5, plannedTaskCount: 5, provisional: false })
    expect(scores[0]?.mean).toBeCloseTo(0.6)

    const portfolio = benchmarkPortfolio(scores, [candidate(baselineId, 'baseline', 1)], baselineId)
    expect(portfolio.leadingRow?.candidateId).toBe(baselineId)
    expect(portfolio.leadingRow?.meanScore).toBeCloseTo(0.6)
    expect(benchmarkPortfolioCoverage(portfolio.leadingRow!, portfolio.benchmarks.length)).toEqual({
      completed: 5,
      total: 5,
    })
  })

  it('keeps a completed iteration on the overview while the active iteration is provisional', () => {
    const completedIterationId = 'iteration-completed' as RefinementIterationId
    const activeIterationId = 'iteration-active' as RefinementIterationId
    const completed: RefinementEvaluationView = {
      evidenceVersion: 'completed',
      evaluations: [{
        ref: {
          providerId: 'hitch', evalId: 'eval_workspace_digest' as HitchEvalId, candidateId: baselineId,
          requestedModelId: 'model', benchmarkId: 'terminal-bench', benchmarkRevision: '2.0',
        },
        status: 'succeeded',
        plannedTasks: 5,
        settledTasks: 5,
        runs: [
          validRun('build-cython-ext', 1, 'empty'),
          validRun('chess-best-move', 1, 'chess'),
          validRun('configure-git-webserver', 0, 'empty'),
          validRun('fix-code-vulnerability', 1, 'security'),
          validRun('polyglot-c-py', 0, 'empty'),
        ],
        diagnostics: [],
      }],
      comparison: { strict: false, dimension: 'harness', referenceRunId: null, exclusions: [], tasks: [] },
    }
    const active: RefinementEvaluationView = {
      ...completed,
      evidenceVersion: 'active',
      evaluations: [{
        ...completed.evaluations[0]!,
        status: 'running',
        settledTasks: 1,
        runs: [validRun('polyglot-c-py', 0, 'empty')],
      }],
    }

    const scores = overviewCombinationScores([
      { id: completedIterationId },
      { id: activeIterationId },
    ], {
      [completedIterationId]: completed,
      [activeIterationId]: active,
    })
    const portfolio = benchmarkPortfolio(scores, [candidate(baselineId, 'baseline', 1)], baselineId)
    expect(scores).toHaveLength(2)
    expect(portfolio.leadingRow?.meanScore).toBeCloseTo(0.6)
    expect(benchmarkPortfolioCoverage(portfolio.leadingRow!, portfolio.benchmarks.length)).toEqual({
      completed: 5,
      total: 5,
    })
  })

  it('computes baseline deltas, regression guardrails, and the Pareto frontier', () => {
    const portfolio = benchmarkPortfolio([
      score(baselineId, 'quality', 0.60, 100),
      score(baselineId, 'safety', 0.70, 100),
      score(safeId, 'quality', 0.70, 250),
      score(safeId, 'safety', 0.80, 250),
      score(qualityId, 'quality', 0.90, 200),
      score(qualityId, 'safety', 0.65, 200),
    ], [
      candidate(baselineId, 'baseline', 1),
      candidate(safeId, 'candidate', 2),
      candidate(qualityId, 'candidate', 3),
    ], baselineId)

    expect(portfolio.benchmarks.map(item => item.id)).toEqual(['quality', 'safety'])
    expect(portfolio.guardrailChecks).toBe(4)
    expect(portfolio.guardrailViolations).toBe(1)
    expect(portfolio.leadingRow?.candidateId).toBe(qualityId)
    expect(portfolio.leadingRow?.meanScore).toBeCloseTo(0.775)
    expect(portfolio.leadingRow?.meanDelta).toBeCloseTo(0.125)

    const quality = portfolio.rows.find(row => row.candidateId === qualityId)
    const safety = quality?.cells.find(cell => cell.benchmark.id === 'safety')
    expect(safety).toMatchObject({ status: 'regressed', guardrailViolation: true })
    expect(safety?.delta).toBeCloseTo(-0.05)
    expect(safety?.delta).toBeLessThan(-BENCHMARK_REGRESSION_GUARDRAIL)
    expect(portfolio.rows.filter(row => row.pareto).map(row => row.candidateId)).toEqual([
      baselineId,
      qualityId,
    ])
  })
})
