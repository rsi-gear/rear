import { runAggregationIdentity, uniqueTrialRuns } from '../run-scoring.ts'
import type {
  HitchRunId,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementEvaluationProjection,
  RefinementEvaluationView,
  RefinementIterationId,
  RefinementIterationRecord,
  RefinementRunView,
} from '../types.ts'
import {
  benchmarkKey,
  overviewCombinationScores,
  type BenchmarkColumn,
  type BenchmarkCombinationScore,
} from './benchmark-dashboard.ts'

/** Identity of one selectable Harness revision. */
export interface ExperimentHarnessOption {
  readonly key: string
  readonly id: string
  readonly revision: string | null
}

/** Identity of one selectable effective model. */
export interface ExperimentModelOption {
  readonly key: string
  readonly id: string
  readonly provider: string | null
  readonly resolved: boolean
}

export type ExperimentCombinationStatus = 'complete' | 'provisional' | 'unscored'

export interface ExperimentBenchmarkColumn extends BenchmarkColumn {
  readonly partition?: 'train' | 'test'
}

/** One benchmark cell in a cross-iteration experiment combination row. */
export interface ExperimentBenchmarkCell {
  readonly benchmark: ExperimentBenchmarkColumn
  readonly score: BenchmarkCombinationScore | null
  readonly baselineScore: number | null
  readonly delta: number | null
  readonly failure: string | null
  /** Retained evidence is selectable even when Gear cannot accept an eval score. */
  readonly evaluationIds: readonly string[]
  readonly runIds: readonly HitchRunId[]
}

/** One traceable iteration × candidate × Harness × Model × evaluation plan row. */
export interface ExperimentCombinationRow {
  readonly key: string
  readonly iterationId: RefinementIterationId
  readonly iterationOrdinal: number
  readonly iterationStatus: RefinementIterationRecord['status']
  readonly directionSummary: string | null
  readonly candidateId: RefinementCandidateId
  readonly candidateLabel: string
  readonly candidateRole: RefinementCandidateRecord['role']
  readonly harness: ExperimentHarnessOption
  readonly model: ExperimentModelOption
  readonly cells: readonly ExperimentBenchmarkCell[]
  readonly meanScore: number | null
  readonly meanDelta: number | null
  readonly meanDurationMs: number | null
  readonly coverageCompleted: number
  readonly coverageTotal: number | null
  readonly validRuns: number
  readonly status: ExperimentCombinationStatus
}

/** Complete projection consumed by both simplified experiment tables. */
export interface ExperimentCombinationTable {
  readonly benchmarks: readonly ExperimentBenchmarkColumn[]
  readonly harnesses: readonly ExperimentHarnessOption[]
  readonly models: readonly ExperimentModelOption[]
  readonly rows: readonly ExperimentCombinationRow[]
  readonly leadingRow: ExperimentCombinationRow | null
}

export function harnessIdentity(value: {
  readonly harnessId: string
  readonly revision: string | null
}): string {
  return `${value.harnessId}\u0000${value.revision ?? ''}`
}

export function modelIdentity(value: {
  readonly provider: string | null
  readonly modelId: string
}): string {
  return value.modelId
}

function rowIdentity(score: Pick<BenchmarkCombinationScore,
  'iterationId' | 'candidateId' | 'harnessId' | 'revision' | 'provider' | 'modelId' | 'protocolIdentity'>,
  planIdentity?: string): string {
  return [
    score.iterationId,
    score.candidateId,
    harnessIdentity(score),
    modelIdentity(score),
    planIdentity === undefined ? score.protocolIdentity : `plan:${planIdentity}`,
  ].join('\u0000')
}

function evidenceMembership(row: ExperimentCombinationRow): Set<string> {
  return new Set(row.cells.flatMap(cell => cell.runIds.map(id => `${cell.benchmark.key}\u0000${id}`)))
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function baselineFor(
  scores: readonly BenchmarkCombinationScore[],
  score: BenchmarkCombinationScore,
  baselineCandidateId: RefinementCandidateId | null,
): BenchmarkCombinationScore | null {
  if (baselineCandidateId === null) return null
  const candidates = scores.filter(candidate => candidate.iterationId === score.iterationId
    && candidate.candidateId === baselineCandidateId
    && benchmarkKey(candidate) === benchmarkKey(score))
  return candidates.find(candidate => modelIdentity(candidate) === modelIdentity(score)
    && candidate.protocolIdentity === score.protocolIdentity)
    ?? candidates.sort((left, right) => Number(left.provisional) - Number(right.provisional) || right.mean - left.mean)[0]
    ?? null
}

/** Build the ranked Benchmark combination table without collapsing iterations. */
export function experimentCombinationTable(
  iterations: readonly RefinementIterationRecord[],
  candidates: readonly RefinementCandidateRecord[],
  baselineCandidateId: RefinementCandidateId | null,
  evaluationHistory: Readonly<Record<string, RefinementEvaluationView>>,
): ExperimentCombinationTable {
  const scores = overviewCombinationScores(iterations, evaluationHistory)
  const benchmarkMap = new Map<string, ExperimentBenchmarkColumn>()
  const planByEvaluation = new Map<string, string>()
  for (const score of scores) {
    const key = benchmarkKey(score)
    benchmarkMap.set(key, { key, id: score.benchmarkId, revision: score.benchmarkRevision })
  }
  for (const [iterationId, evaluation] of Object.entries(evaluationHistory)) {
    for (const item of evaluation.evaluations) {
      const key = benchmarkKey(item.ref)
      benchmarkMap.set(key, { ...benchmarkMap.get(key), key, id: item.ref.benchmarkId, revision: item.ref.benchmarkRevision,
        ...(item.ref.partition === undefined ? {} : { partition: item.ref.partition }) })
      if (item.ref.planIdentity !== undefined) {
        planByEvaluation.set(`${iterationId}\u0000${item.ref.evalId}`, item.ref.planIdentity)
      }
    }
  }
  const benchmarks = [...benchmarkMap.values()]
    .sort((left, right) => left.id.localeCompare(right.id)
      || (left.partition === 'train' ? 0 : left.partition === 'test' ? 1 : 2) - (right.partition === 'train' ? 0 : right.partition === 'test' ? 1 : 2)
      || left.revision.localeCompare(right.revision))
  const iterationById = new Map(iterations.map(iteration => [iteration.id, iteration]))
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]))
  type Identity = Pick<BenchmarkCombinationScore, 'iterationId' | 'candidateId' | 'harnessId'
    | 'revision' | 'provider' | 'modelId' | 'modelResolved' | 'protocolIdentity'>
  const groups = new Map<string, {
    identity: Identity
    scores: BenchmarkCombinationScore[]
    evidence: { evaluation: RefinementEvaluationProjection; run: RefinementRunView }[]
  }>()
  for (const score of scores) {
    const key = rowIdentity(score, planByEvaluation.get(`${score.iterationId}\u0000${score.evaluationIds[0]}`))
    const group = groups.get(key) ?? { identity: score, scores: [], evidence: [] }
    group.scores.push(score)
    groups.set(key, group)
  }
  for (const iteration of iterations) {
    for (const evaluation of evaluationHistory[iteration.id]?.evaluations ?? []) {
      for (const run of evaluation.runs) {
        const identity: Identity = {
          iterationId: iteration.id, candidateId: run.candidateId,
          harnessId: run.harness.id, revision: run.harness.revisionIdentity,
          modelId: run.model.effectiveId ?? run.model.requestedId, provider: run.model.provider,
          modelResolved: run.model.provider !== null && run.model.effectiveId !== null,
          protocolIdentity: runAggregationIdentity(run),
        }
        const key = rowIdentity(identity, evaluation.ref.planIdentity)
        const group = groups.get(key) ?? { identity, scores: [], evidence: [] }
        if (identity.modelResolved) group.identity = identity
        group.evidence.push({ evaluation, run })
        groups.set(key, group)
      }
    }
  }

  // Keep membership independent of run order, without inventing empty combinations.
  const scoreRows = [...groups.entries()]
    .filter(([, group]) => group.scores.length > 0 || group.evidence.some(item => trajectoryAvailable(item.run)))
    .map(([key, group]): ExperimentCombinationRow => {
    const first = group.identity
    const resolvedModel = group.scores.find(score => score.modelResolved) ?? first
    const iteration = iterationById.get(first.iterationId)
    const candidate = candidateById.get(first.candidateId)
    const cells = benchmarks.map((benchmark): ExperimentBenchmarkCell => {
      const score = group.scores.find(item => benchmarkKey(item) === benchmark.key) ?? null
      const evidence = group.evidence.filter(item => benchmarkKey(item.evaluation.ref) === benchmark.key)
      const baseline = score === null ? null : baselineFor(scores, score, baselineCandidateId)
      const baselineScore = baseline?.mean ?? null
      const delta = score === null || baselineScore === null
        ? null
        : score.candidateId === baselineCandidateId ? 0 : score.mean - baselineScore
      return {
        benchmark, score, baselineScore, delta,
        failure: score === null
          ? evidence.find(item => item.evaluation.ref.failedEvaluation !== undefined)?.evaluation.ref.failedEvaluation?.message ?? null
          : null,
        evaluationIds: [...new Set([...(score?.evaluationIds ?? []), ...evidence.map(item => item.evaluation.ref.evalId)])].sort(),
        runIds: [...new Set(evidence.map(item => item.run.id))].sort(),
      }
    })
    const available = cells.flatMap(cell => cell.score === null ? [] : [cell.score])
    const deltas = cells.flatMap(cell => cell.delta === null ? [] : [cell.delta])
    const durationWeight = available.reduce((sum, score) => sum + (score.meanDurationMs === null ? 0 : score.runCount), 0)
    const provisional = available.some(score => score.provisional) || available.length < benchmarks.length
    const single = benchmarks.length === 1 ? available[0] : undefined
    const retainedValidRuns = uniqueTrialRuns(group.evidence.map(item => item.run))
      .filter(run => run.integrity === 'valid' && run.observation.state === 'valid')
    const plannedCounts = group.evidence.flatMap(item => item.evaluation.plannedTasks === null ? [] : [item.evaluation.plannedTasks])
    return {
      key,
      iterationId: first.iterationId,
      iterationOrdinal: iteration?.ordinal ?? 0,
      iterationStatus: iteration?.status ?? 'failed',
      directionSummary: candidate?.directionSummary ?? (candidate?.role === 'baseline' ? null : iteration?.directionSummary) ?? null,
      candidateId: first.candidateId,
      candidateLabel: candidate?.label ?? String(first.candidateId),
      candidateRole: candidate?.role ?? 'candidate',
      harness: { key: harnessIdentity(first), id: first.harnessId, revision: first.revision },
      model: {
        key: modelIdentity(resolvedModel), id: resolvedModel.modelId, provider: resolvedModel.provider,
        resolved: resolvedModel.modelResolved,
      },
      cells,
      meanScore: mean(available.map(score => score.mean)),
      meanDelta: available.length === 0 ? null : first.candidateId === baselineCandidateId ? 0 : mean(deltas),
      meanDurationMs: durationWeight === 0 ? null : available.reduce((sum, score) => (
        sum + (score.meanDurationMs ?? 0) * score.runCount
      ), 0) / durationWeight,
      coverageCompleted: benchmarks.length === 1
        ? single?.taskCount ?? new Set(retainedValidRuns.map(run => run.taskKey)).size : available.length,
      coverageTotal: benchmarks.length === 1
        ? single?.plannedTaskCount ?? (plannedCounts.length === 0 ? null : Math.max(...plannedCounts)) : benchmarks.length,
      validRuns: retainedValidRuns.length,
      status: available.length === 0 ? 'unscored' : provisional ? 'provisional' : 'complete',
    }
  })
  // Reused baselines can gain a held-out eval in a later round. Keep the complete
  // evidence owner instead of retaining both its old train-only row and its superset.
  const memberships = new Map(scoreRows.map(row => [row.key, evidenceMembership(row)]))
  const rows = scoreRows.filter(row => {
    const membership = memberships.get(row.key)!
    return !scoreRows.some(other => {
      if (other.key === row.key || other.candidateId !== row.candidateId
        || other.harness.key !== row.harness.key || other.model.key !== row.model.key) return false
      const superset = memberships.get(other.key)!
      return membership.size > 0 && [...membership].every(id => superset.has(id))
        && (superset.size > membership.size || other.iterationOrdinal < row.iterationOrdinal)
    })
  }).sort((left, right) => {
    const statusRank = { complete: 0, provisional: 1, unscored: 2 } as const
    const leftCoverage = left.coverageTotal === null ? 0 : left.coverageCompleted / Math.max(1, left.coverageTotal)
    const rightCoverage = right.coverageTotal === null ? 0 : right.coverageCompleted / Math.max(1, right.coverageTotal)
    return statusRank[left.status] - statusRank[right.status]
      || rightCoverage - leftCoverage
      || (right.meanScore ?? Number.NEGATIVE_INFINITY) - (left.meanScore ?? Number.NEGATIVE_INFINITY)
      || (left.meanDurationMs ?? Number.POSITIVE_INFINITY) - (right.meanDurationMs ?? Number.POSITIVE_INFINITY)
      || right.iterationOrdinal - left.iterationOrdinal
  })
  const harnesses = [...new Map(rows.map(row => [row.harness.key, row.harness])).values()]
    .sort((left, right) => left.id.localeCompare(right.id) || (left.revision ?? '').localeCompare(right.revision ?? ''))
  const modelsByKey = new Map<string, ExperimentModelOption>()
  for (const row of rows) {
    const current = modelsByKey.get(row.model.key)
    if (current === undefined || (!current.resolved && row.model.resolved)) modelsByKey.set(row.model.key, row.model)
  }
  const models = [...modelsByKey.values()]
    .sort((left, right) => left.id.localeCompare(right.id) || (left.provider ?? '').localeCompare(right.provider ?? ''))
  return {
    benchmarks,
    harnesses,
    models,
    rows,
    leadingRow: rows.find(row => row.meanScore !== null) ?? null,
  }
}

export interface ExperimentTaskCell {
  readonly columnKey: string
  readonly mean: number | null
  readonly processMean: number | null
  readonly runs: readonly RefinementRunView[]
  readonly selectableRunIds: readonly HitchRunId[]
}

/** Prefer benchmarks shared by every selected row; otherwise show the union with gaps. */
export function experimentBenchmarkSelection(
  table: ExperimentCombinationTable,
  selectedColumnKeys: readonly string[],
  preferredKey: string | null,
): { benchmarks: readonly ExperimentBenchmarkColumn[]; activeKey: string | null; shared: boolean } {
  const selected = table.rows.filter(row => selectedColumnKeys.includes(row.key))
  const coverage = (key: string): number => selected.filter(row => row.cells.some(cell => cell.benchmark.key === key && cell.runIds.length > 0)).length
  const available = selected.length === 0 ? table.benchmarks : table.benchmarks.filter(benchmark => coverage(benchmark.key) > 0)
  const common = selected.length === 0 ? available : available.filter(benchmark => coverage(benchmark.key) === selected.length)
  const preferred = common.length > 0 ? common : available
  return {
    benchmarks: preferred,
    activeKey: preferred.find(benchmark => benchmark.key === preferredKey)?.key ?? preferred[0]?.key ?? null,
    shared: selected.length < 2 || common.length > 0,
  }
}

/** Only live evaluations belong in the transient progress strip. */
export function activeExperimentEvaluations(history: Readonly<Record<string, RefinementEvaluationView>>): RefinementEvaluationProjection[] {
  return [...new Map(Object.values(history).flatMap(view => view.evaluations)
    .map(evaluation => [evaluation.ref.evalId, evaluation])).values()]
    .filter(evaluation => evaluation.ref.rerunning === true
      || (evaluation.ref.failedEvaluation === undefined && ['queued', 'running', 'rerunning'].includes(evaluation.status)))
}

export interface ExperimentTaskRow {
  readonly taskKey: string
  readonly taskId: string
  readonly cells: readonly ExperimentTaskCell[]
  /** Signed second-minus-first delta for two columns, otherwise max-minus-min range. */
  readonly difference: number | null
  readonly differenceMagnitude: number
  readonly changed: boolean
}

export interface ExperimentTaskMatrix {
  readonly columns: readonly ExperimentCombinationRow[]
  readonly rows: readonly ExperimentTaskRow[]
  readonly invalidSelection: boolean
}

function runMatchesColumn(run: RefinementRunView, column: ExperimentCombinationRow): boolean {
  return run.candidateId === column.candidateId
    && harnessIdentity({ harnessId: run.harness.id, revision: run.harness.revisionIdentity }) === column.harness.key
    && modelIdentity({ provider: run.model.provider, modelId: run.model.effectiveId ?? run.model.requestedId }) === column.model.key
}

function trajectoryAvailable(run: RefinementRunView): boolean {
  return run.integrity !== 'corrupt'
    && (run.trajectory.availability === 'available' || run.trajectory.availability === 'provider-only')
}

/** Build the task × combination matrix selected by Benchmark, Harness, and Model. */
export function experimentTaskMatrix(
  table: ExperimentCombinationTable,
  evaluationHistory: Readonly<Record<string, RefinementEvaluationView>>,
  selectedBenchmarkKey: string | null,
  selectedColumnKeys: readonly string[],
): ExperimentTaskMatrix {
  const invalidSelection = false
  if (selectedBenchmarkKey === null) return { columns: [], rows: [], invalidSelection }
  const selected = new Set(selectedColumnKeys)
  const columns = table.rows.filter(row => selected.has(row.key))
    .sort((left, right) => left.iterationOrdinal - right.iterationOrdinal
      || Number(left.candidateRole !== 'baseline') - Number(right.candidateRole !== 'baseline'))
  const runGroups = new Map<string, RefinementRunView[]>()
  for (const column of columns) {
    const evaluation = evaluationHistory[column.iterationId]
    const retainedIds = new Set(column.cells.find(cell => cell.benchmark.key === selectedBenchmarkKey)?.runIds)
    const runs = evaluation?.evaluations
      .filter(item => benchmarkKey(item.ref) === selectedBenchmarkKey)
      .flatMap(item => item.runs.filter(run => retainedIds.has(run.id) && runMatchesColumn(run, column))) ?? []
    runGroups.set(column.key, runs)
  }
  const tasks = new Map<string, string>()
  for (const runs of runGroups.values()) for (const run of runs) tasks.set(run.taskKey, run.taskId)
  const rows = [...tasks.entries()].map(([taskKey, taskId]): ExperimentTaskRow => {
    const cells = columns.map((column): ExperimentTaskCell => {
      const runs = (runGroups.get(column.key) ?? []).filter(run => run.taskKey === taskKey)
        .sort((left, right) => left.attempt - right.attempt)
      const score = column.cells.find(cell => cell.benchmark.key === selectedBenchmarkKey)?.score
      const scoredRuns = uniqueTrialRuns(score == null ? runs : runs.filter(run => score.runIds.includes(run.id)))
      const rewards = scoredRuns.flatMap(run => run.integrity === 'valid' && run.observation.state === 'valid'
        ? [run.observation.reward] : [])
      const processScores = scoredRuns.flatMap(run => run.integrity === 'valid' && run.observation.state === 'valid' && run.verifier?.scores.process_score !== undefined ? [run.verifier.scores.process_score] : [])
      return {
        columnKey: column.key,
        mean: mean(rewards),
        processMean: mean(processScores),
        runs,
        selectableRunIds: runs.filter(trajectoryAvailable).map(run => run.id),
      }
    })
    const values = cells.flatMap(cell => cell.mean === null ? [] : [cell.mean])
    const difference = values.length < 2 ? null : values.length === 2
      ? (values[1] as number) - (values[0] as number)
      : Math.max(...values) - Math.min(...values)
    const firstMean = cells[0]?.mean ?? null
    const changed = columns.length >= 2 && cells.slice(1).some(cell => (
      firstMean === null || cell.mean === null
        ? firstMean !== cell.mean
        : Math.abs(cell.mean - firstMean) > 1e-12
    ))
    return {
      taskKey,
      taskId,
      cells,
      difference,
      differenceMagnitude: values.length < 2 ? 0 : Math.max(...values) - Math.min(...values),
      changed,
    }
  }).sort((left, right) => right.differenceMagnitude - left.differenceMagnitude || left.taskId.localeCompare(right.taskId))
  return { columns, rows, invalidSelection }
}
