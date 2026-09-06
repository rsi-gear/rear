import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  HitchEvalId,
  HitchRunId,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementEvaluationProjection,
  RefinementEvaluationView,
  RefinementIterationId,
  RefinementIterationRecord,
  RefinementRunView,
  RefinementRecordV1,
} from '../../src/types.ts'
import { benchmarkKey } from '../../src/client/benchmark-dashboard.ts'
import {
  experimentCombinationTable,
  experimentTaskMatrix,
  experimentBenchmarkSelection,
  activeExperimentEvaluations,
} from '../../src/client/experiment-tables.ts'
import { ExperimentTablesView } from '../../src/client/ExperimentTablesView.tsx'
import { zh } from '../../src/client/locales.ts'

const candidateId = 'candidate-table' as RefinementCandidateId
const candidate: RefinementCandidateRecord = {
  id: candidateId,
  role: 'baseline',
  parentCandidateId: null,
  requestedHarnessRef: 'harness-a',
  revisionIdentity: 'revision-a',
  label: 'Initial combination',
  createdAt: 1,
}

function iteration(id: string, ordinal: number, directionSummary?: string): RefinementIterationRecord {
  return {
    id: id as RefinementIterationId,
    ordinal,
    status: 'settled',
    candidateIds: [candidateId],
    evaluationRefs: [],
    createdAt: ordinal,
    ...(directionSummary === undefined ? {} : { directionSummary }),
  }
}

function run(
  id: string,
  evalId: HitchEvalId,
  task: string,
  reward: number,
  attempt = 1,
  owner = candidateId,
  harnessId = 'harness-a',
): RefinementRunView {
  return {
    id: id as HitchRunId,
    evalId,
    candidateId: owner,
    trialId: `${task}-${attempt}`,
    attempt,
    taskKey: `task-key-${task}`,
    taskId: task,
    execution: 'succeeded',
    observation: { state: 'valid', reward },
    integrity: 'valid',
    harness: { requestedRef: harnessId, id: harnessId, revisionIdentity: `revision-${harnessId}` },
    model: { requestedId: 'model-a', provider: 'provider-a', effectiveId: 'model-a' },
    protocolIdentity: JSON.stringify({
      environment_identity: 'environment-a',
      initial_workspace_digest: `workspace-${task}`,
      timeout_ms: 1_000,
    }),
    trajectory: { availability: 'available', hasCanonical: true, providerFileCount: 0 },
  }
}

function projection(
  id: string,
  rewards: readonly [string, number, number?][],
  owner = candidateId,
  harnessId = 'harness-a',
): RefinementEvaluationView {
  const evalId = `eval-${id}` as HitchEvalId
  const evaluation: RefinementEvaluationProjection = {
    ref: {
      providerId: 'hitch',
      evalId,
      candidateId: owner,
      requestedModelId: 'model-a',
      benchmarkId: 'benchmark-a',
      benchmarkRevision: 'revision-a',
    },
    status: 'succeeded',
    plannedTasks: 2,
    settledTasks: 2,
    runs: rewards.map(([task, reward, attempt = 1], index) => run(
      `run-${id}-${index}`,
      evalId,
      task,
      reward,
      attempt,
      owner,
      harnessId,
    )),
    diagnostics: [],
  }
  return {
    evidenceVersion: id,
    evaluations: [evaluation],
    comparison: { strict: true, dimension: 'harness', referenceRunId: null, exclusions: [], tasks: [] },
  }
}

describe('experiment detail tables', () => {
  function splitEvaluation(id: string, partition: 'train' | 'test', owner = candidateId): RefinementEvaluationProjection {
    const source = projection(id, [[`${partition}-a`, 1], [`${partition}-b`, 0]], owner).evaluations[0]!
    return { ...source, ref: { ...source.ref, partition, planIdentity: 'train-and-test-plan',
      conditionId: `condition-${partition}`, benchmarkRevision: `revision-${partition}` },
    runs: source.runs.map(run => ({ ...run, aggregationIdentity: JSON.stringify({ conditionId: `condition-${partition}` }) })) }
  }

  it('combines train/test from one Gear plan and keeps the complete owner of a reused baseline', () => {
    const old = iteration('old-round', 2)
    const current = iteration('current-round', 3, 'Candidate-only improvement')
    const optimized = { ...candidate, id: 'optimized' as RefinementCandidateId, role: 'candidate' as const }
    const baselineTrain = splitEvaluation('baseline-train', 'train')
    const history = {
      [old.id]: { ...projection('old', []), evaluations: [baselineTrain] },
      [current.id]: { ...projection('current', []), evaluations: [baselineTrain,
        splitEvaluation('baseline-test', 'test'), splitEvaluation('candidate-train', 'train', optimized.id),
        splitEvaluation('candidate-test', 'test', optimized.id)] },
    }
    const table = experimentCombinationTable([old, current], [candidate, optimized], candidateId, history)
    expect(table.benchmarks.map(item => item.partition)).toEqual(['train', 'test'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows.every(row => row.iterationOrdinal === 3 && row.status === 'complete' && row.coverageCompleted === 2)).toBe(true)
    expect(table.rows.find(row => row.candidateRole === 'baseline')?.directionSummary).toBeNull()
    for (const benchmark of table.benchmarks) {
      const matrix = experimentTaskMatrix(table, history, benchmark.key, table.rows.map(row => row.key))
      expect(matrix.columns.map(row => row.candidateRole)).toEqual(['baseline', 'candidate'])
      expect(matrix.rows).toHaveLength(2)
      expect(matrix.rows.every(row => row.cells.length === 2 && row.taskId.startsWith(benchmark.partition!))).toBe(true)
      expect(new Set(matrix.rows.flatMap(row => row.cells.flatMap(cell => cell.selectableRunIds))).size).toBe(4)
    }
    const html = renderToStaticMarkup(createElement(ExperimentTablesView, {
      detail: { id: 'experiment', iterations: [old, current], candidates: [candidate, optimized], baselineCandidateId: candidateId } as unknown as RefinementRecordV1,
      evaluationHistory: history, onSelectRuns: async () => {}, t: key => zh[key],
    }))
    expect(html).toContain('迭代 03 · 基线')
    expect(html).toContain('迭代 03 · 候选')
    expect(html).not.toContain('迭代 02')
    expect(html).toContain('benchmark-a · 训练集')
    expect(html).toContain('benchmark-a · 测试集')
  })

  it('preserves distinct protocol rows when there is no authoritative shared Gear plan', () => {
    const current = iteration('protocols', 1)
    const first = projection('one-protocol', [['task-a', 1]])
    const second = projection('other-protocol', [['task-a', 0]])
    const history = { [current.id]: { ...first, evaluations: [...first.evaluations,
      ...second.evaluations.map(evaluation => ({ ...evaluation, runs: evaluation.runs.map(run => ({ ...run, protocolIdentity: '{"timeout_ms":2000}' })) }))] } }
    const table = experimentCombinationTable([current], [candidate], candidateId, history)
    expect(table.rows).toHaveLength(2)
    const matrix = experimentTaskMatrix(table, history, table.benchmarks[0]!.key, table.rows.map(row => row.key))
    expect(matrix.rows[0]?.cells.map(cell => cell.mean).sort()).toEqual([0, 1])
    expect(matrix.rows[0]?.cells.every(cell => cell.runs.length === 1)).toBe(true)
  })

  it('automatically selects a shared benchmark and preserves a valid manual selection', () => {
    const first = iteration('both-splits', 1)
    const second = iteration('test-only', 2)
    const history = {
      [first.id]: { ...projection('first', []), evaluations: [splitEvaluation('one-train', 'train'), splitEvaluation('one-test', 'test')] },
      [second.id]: { ...projection('second', []), evaluations: [splitEvaluation('two-test', 'test')] },
    }
    const table = experimentCombinationTable([first, second], [candidate], candidateId, history)
    const train = table.benchmarks[0]!.key
    const test = table.benchmarks[1]!.key
    const selected = table.rows.map(row => row.key)
    const choice = experimentBenchmarkSelection(table, selected, train)
    expect(choice).toMatchObject({ activeKey: test, shared: true })
    expect(choice.benchmarks).toHaveLength(1)
    expect(experimentTaskMatrix(table, history, choice.activeKey, selected).columns).toHaveLength(2)
    expect(experimentBenchmarkSelection(table, [table.rows.find(row => row.iterationId === first.id)!.key], test).activeKey).toBe(test)
    expect(experimentBenchmarkSelection(table, selected, 'stale-key').activeKey).toBe(test)
  })

  it('keeps both selected columns with explicit gaps when benchmarks do not overlap', () => {
    const first = iteration('train-only', 1)
    const second = iteration('test-only', 2)
    const history = {
      [first.id]: { ...projection('first', []), evaluations: [splitEvaluation('one-train', 'train')] },
      [second.id]: { ...projection('second', []), evaluations: [splitEvaluation('two-test', 'test')] },
    }
    const table = experimentCombinationTable([first, second], [candidate], candidateId, history)
    const selected = table.rows.map(row => row.key)
    const choice = experimentBenchmarkSelection(table, selected, null)
    expect(choice.shared).toBe(false)
    const matrix = experimentTaskMatrix(table, history, choice.activeKey, selected)
    expect(matrix.columns).toHaveLength(2)
    expect(matrix.rows.every(row => row.cells[1]?.mean === null)).toBe(true)
  })

  it('only shows live progress, deduplicates reused evals and excludes interrupted evidence', () => {
    const completed = splitEvaluation('completed', 'train')
    const running = { ...splitEvaluation('running', 'test'), status: 'running' as const, settledTasks: 1 }
    const interrupted = { ...running, ref: { ...running.ref, evalId: 'eval-interrupted' as HitchEvalId,
      failedEvaluation: { phase: 'seed-baseline', code: 'interrupted', message: 'interrupted' } } }
    const history = { a: { ...projection('a', []), evaluations: [completed, running, interrupted] },
      b: { ...projection('b', []), evaluations: [running] } }
    expect(activeExperimentEvaluations(history)).toEqual([running])
    expect(activeExperimentEvaluations({ a: { ...projection('a', []), evaluations: [completed] } })).toEqual([])
  })

  it('keeps repeated Harness/Model evaluations in separate iteration rows', () => {
    const first = iteration('iteration-1', 1, 'Reduce unnecessary tool calls')
    const second = iteration('iteration-2', 2, 'Improve repository inspection')
    const history = {
      [first.id]: projection('one', [['task-a', 1], ['task-b', 0]]),
      [second.id]: projection('two', [['task-a', 1], ['task-b', 1]]),
    }
    const table = experimentCombinationTable([first, second], [{ ...candidate, role: 'candidate' }], candidateId, history)
    const matrix = experimentTaskMatrix(
      table,
      history,
      benchmarkKey({ benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a' }),
      table.rows.map(row => row.key),
    )

    expect(table.rows).toHaveLength(2)
    expect(table.rows.map(row => row.iterationOrdinal)).toEqual([2, 1])
    expect(table.rows.map(row => row.directionSummary)).toEqual([
      'Improve repository inspection',
      'Reduce unnecessary tool calls',
    ])
    expect(table.leadingRow?.meanScore).toBe(1)
    expect(table.rows[1]?.meanScore).toBe(0.5)
    expect(matrix.rows.find(row => row.taskId === 'task-b')?.changed).toBe(true)
    expect(matrix.rows.find(row => row.taskId === 'task-a')?.changed).toBe(false)
  })

  it('does not duplicate one reused eval/run set as two iteration columns', () => {
    const first = iteration('iteration-1', 1)
    const second = iteration('iteration-2', 2, 'Try a new candidate direction')
    const reused = projection('shared', [['task-a', 1], ['task-b', 0]])
    const history = { [first.id]: reused, [second.id]: reused }
    const table = experimentCombinationTable([first, second], [candidate], candidateId, history)
    const matrix = experimentTaskMatrix(
      table,
      history,
      benchmarkKey({ benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a' }),
      [table.rows[0]?.key as string],
    )

    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]?.iterationOrdinal).toBe(1)
    expect(matrix.columns).toHaveLength(1)
    expect(new Set(matrix.rows.flatMap(row => row.cells.flatMap(cell => cell.selectableRunIds))).size).toBe(2)
  })

  it('deduplicates one requested model even when only one iteration has resolved provider metadata', () => {
    const current = iteration('iteration-unresolved-model', 1)
    const next = iteration('iteration-resolved-model', 2)
    const resolved = projection('unresolved-model', [['task-a', 1], ['task-b', 0]])
    const unresolved: RefinementEvaluationView = {
      ...resolved,
      evaluations: resolved.evaluations.map(evaluation => ({
        ...evaluation,
        runs: evaluation.runs.map(item => ({
          ...item,
          model: { ...item.model, effectiveId: null },
        })),
      })),
    }
    const table = experimentCombinationTable([current, next], [candidate], candidateId, {
      [current.id]: unresolved,
      [next.id]: projection('resolved-model', [['task-a', 1], ['task-b', 0]]),
    })

    expect(table.rows).toHaveLength(2)
    expect(table.rows.every(row => row.status === 'complete')).toBe(true)
    expect(table.rows.every(row => row.meanScore === 0.5)).toBe(true)
    expect(table.models).toHaveLength(1)
    expect(table.models[0]).toMatchObject({ id: 'model-a', provider: 'provider-a', resolved: true })
    expect(table.leadingRow).not.toBeNull()
  })

  it('aligns tasks across iteration columns and averages attempts within each task', () => {
    const first = iteration('iteration-1', 1)
    const second = iteration('iteration-2', 2)
    const history = {
      [first.id]: projection('one', [['task-a', 1], ['task-a', 0, 2], ['task-b', 0]]),
      [second.id]: projection('two', [['task-a', 1], ['task-b', 1]]),
    }
    const table = experimentCombinationTable([first, second], [candidate], candidateId, history)
    const matrix = experimentTaskMatrix(
      table,
      history,
      benchmarkKey({ benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a' }),
      table.rows.map(row => row.key),
    )

    expect(matrix.columns).toHaveLength(2)
    expect(matrix.columns.map(column => column.iterationOrdinal)).toEqual([1, 2])
    expect(matrix.rows.map(row => row.taskId)).toEqual(['task-b', 'task-a'])
    expect(matrix.rows[0]).toMatchObject({ changed: true, difference: 1 })
    expect(matrix.rows[1]?.cells.map(cell => cell.mean)).toEqual([0.5, 1])
    expect(matrix.rows[1]).toMatchObject({ changed: true, difference: 0.5 })
    expect(matrix.rows[1]?.cells[0]?.selectableRunIds).toHaveLength(2)
  })

  it('compares two explicitly selected iterations and exposes distinct trajectory runs', () => {
    const optimizedId = 'candidate-optimized' as RefinementCandidateId
    const optimized: RefinementCandidateRecord = {
      id: optimizedId,
      role: 'candidate',
      parentCandidateId: candidateId,
      requestedHarnessRef: 'harness-b',
      revisionIdentity: 'revision-harness-b',
      label: 'Optimized harness',
      directionSummary: 'Keep the verified final state intact.',
      createdAt: 2,
    }
    const first = iteration('iteration-1', 1)
    const second: RefinementIterationRecord = {
      ...iteration('iteration-2', 2),
      candidateIds: [optimizedId],
    }
    const history = {
      [first.id]: projection('baseline', [['task-a', 1], ['task-b', 0]]),
      [second.id]: projection('optimized', [['task-a', 0], ['task-b', 1]], optimizedId, 'harness-b'),
    }
    const table = experimentCombinationTable([first, second], [candidate, optimized], candidateId, history)
    const matrix = experimentTaskMatrix(
      table,
      history,
      benchmarkKey({ benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a' }),
      table.rows.map(row => row.key),
    )

    expect(matrix.columns.map(column => column.candidateId)).toEqual([candidateId, optimizedId])
    expect(matrix.rows).toHaveLength(2)
    expect(matrix.rows.every(row => row.cells.length === 2)).toBe(true)
    expect(matrix.rows.every(row => row.changed)).toBe(true)
    expect(new Set(matrix.rows.flatMap(row => row.cells.flatMap(cell => cell.selectableRunIds))).size).toBe(4)
  })

  it('shows every checked iteration as a task comparison column', () => {
    const first = iteration('iteration-1', 1)
    const second = iteration('iteration-2', 2)
    const third = iteration('iteration-3', 3)
    const history = {
      [first.id]: projection('one', [['task-a', 1], ['task-b', 0]]),
      [second.id]: projection('two', [['task-a', 0], ['task-b', 1]]),
      [third.id]: projection('three', [['task-a', 1], ['task-b', 1]]),
    }
    const table = experimentCombinationTable([first, second, third], [candidate], candidateId, history)
    const matrix = experimentTaskMatrix(
      table,
      history,
      benchmarkKey({ benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a' }),
      table.rows.map(row => row.key),
    )
    expect(matrix.invalidSelection).toBe(false)
    expect(matrix.columns.map(column => column.iterationOrdinal)).toEqual([1, 2, 3])
    expect(matrix.rows).toHaveLength(2)
    expect(matrix.rows.every(row => row.cells.length === 3)).toBe(true)
    expect(matrix.rows.every(row => row.changed)).toBe(true)
  })

  it('omits failed Gear evaluations without scores from the Benchmark result rows', () => {
    const current = iteration('iteration-failed', 1, 'Try a stricter verifier protocol')
    const evalId = 'eval-failed' as HitchEvalId
    const failed: RefinementEvaluationView = {
      evidenceVersion: 'failed',
      evaluations: [{
        ref: {
          providerId: 'hitch', evalId, candidateId, requestedModelId: 'model-a',
          benchmarkId: 'benchmark-a', benchmarkRevision: 'revision-a',
          failedEvaluation: { phase: 'held-out-candidate', code: 'invalid-observation', message: 'no valid reward' },
        },
        status: 'failed',
        plannedTasks: 2,
        settledTasks: 2,
        runs: [],
        diagnostics: [],
      }],
      comparison: { strict: false, dimension: 'harness', referenceRunId: null, exclusions: [], tasks: [] },
    }
    const table = experimentCombinationTable([current], [candidate], candidateId, { [current.id]: failed })
    expect(table.benchmarks).toHaveLength(1)
    expect(table.rows).toHaveLength(0)
    expect(table.leadingRow).toBeNull()
  })

  it('does not add a result row for a failed candidate with no evaluation score', () => {
    const failedCandidateId = 'candidate-failed-before-eval' as RefinementCandidateId
    const failedCandidate: RefinementCandidateRecord = {
      id: failedCandidateId,
      role: 'candidate',
      parentCandidateId: candidateId,
      requestedHarnessRef: 'candidate-commit',
      revisionIdentity: null,
      label: 'Failed candidate',
      status: 'failed',
      directionSummary: 'Keep the verified deployment intact.',
      failure: { code: 'candidate-seed-running', message: 'seed evaluation had invalid tasks' },
      createdAt: 2,
    }
    const current: RefinementIterationRecord = {
      ...iteration('iteration-with-failed-candidate', 1),
      candidateIds: [candidateId, failedCandidateId],
    }
    const history = { [current.id]: projection('baseline-only', [['task-a', 1], ['task-b', 0]]) }
    const table = experimentCombinationTable(
      [current],
      [candidate, failedCandidate],
      candidateId,
      history,
    )
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]?.candidateId).toBe(candidateId)
    expect(table.rows.some(row => row.candidateId === failedCandidateId)).toBe(false)
  })

  it.each(['running', 'failed'] as const)('keeps completed trajectories selectable after Gear interrupts a %s Hitch eval', status => {
    const current = { ...iteration('interrupted', 1), status: 'failed' as const }
    const source = projection('interrupted', [['task-a', 1], ['task-b', 0]])
    const interrupted: RefinementEvaluationView = {
      ...source,
      evaluations: source.evaluations.map(evaluation => ({
        ...evaluation, status, plannedTasks: 80,
        ref: { ...evaluation.ref, failedEvaluation: {
          phase: 'seed-baseline', code: 'evaluation_interrupted_by_restart', message: 'control plane restarted',
        } },
        runs: evaluation.runs.map((run, index) => index === 0 ? run : {
          ...run, observation: { state: 'invalid' as const, reason: 'verifier timeout' },
        }),
      })),
    }
    const history = { [current.id]: interrupted }
    const table = experimentCombinationTable([current], [candidate], candidateId, history)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0]).toMatchObject({ status: 'unscored', meanScore: null, meanDelta: null, coverageCompleted: 1, coverageTotal: 80 })
    expect(table.leadingRow).toBeNull()
    expect(table.rows[0]?.cells[0]).toMatchObject({ score: null, failure: 'control plane restarted', evaluationIds: ['eval-interrupted'] })
    const matrix = experimentTaskMatrix(table, history, table.benchmarks[0]!.key, [table.rows[0]!.key])
    expect(matrix.rows).toHaveLength(2)
    expect(matrix.rows.flatMap(row => row.cells.flatMap(cell => cell.selectableRunIds))).toEqual(['run-interrupted-0', 'run-interrupted-1'])
    expect(matrix.rows.map(row => row.cells[0]?.mean)).toEqual([1, null])
  })

  it('exposes retained trajectories even when no task has a valid verifier score', () => {
    const current = iteration('verifier-failed', 1)
    const source = projection('verifier-failed', [['task-a', 0]])
    const history = { [current.id]: {
      ...source,
      evaluations: source.evaluations.map(evaluation => ({
        ...evaluation, status: 'failed' as const,
        runs: evaluation.runs.map(run => ({ ...run, observation: { state: 'invalid' as const, reason: 'verifier timeout' } })),
      })),
    } }
    const table = experimentCombinationTable([current], [candidate], candidateId, history)
    expect(table.rows[0]).toMatchObject({ status: 'unscored', meanScore: null })
    expect(table.leadingRow).toBeNull()
    const matrix = experimentTaskMatrix(table, history, table.benchmarks[0]!.key, [table.rows[0]!.key])
    expect(matrix.rows[0]?.cells[0]).toMatchObject({ mean: null, selectableRunIds: ['run-verifier-failed-0'] })
  })

  it('retains failed-eval trajectories alongside scored evidence without changing the accepted averages', () => {
    const current = iteration('mixed', 1)
    const scored = projection('scored', [['task-a', 0], ['task-b', 0]])
    const failed = projection('failed', [['task-a', 1], ['task-b', 1]])
    const history = { [current.id]: {
      ...scored,
      evaluations: [...scored.evaluations, ...failed.evaluations.map(evaluation => ({
        ...evaluation, status: 'failed' as const,
        ref: { ...evaluation.ref, failedEvaluation: { phase: 'seed-baseline', code: 'interrupted', message: 'interrupted' } },
      }))],
    } }
    const table = experimentCombinationTable([current], [candidate], candidateId, history)
    expect(table.rows).toHaveLength(1)
    expect(table.leadingRow?.meanScore).toBe(0)
    const matrix = experimentTaskMatrix(table, history, table.benchmarks[0]!.key, [table.rows[0]!.key])
    expect(matrix.rows.map(row => row.cells[0]?.mean)).toEqual([0, 0])
    expect(matrix.rows.every(row => row.cells[0]?.selectableRunIds.length === 2)).toBe(true)
  })
})
