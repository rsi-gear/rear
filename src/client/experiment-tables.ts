import type {
  HitchRunId,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementEvaluationView,
  RefinementIterationId,
  RefinementIterationRecord,
  RefinementRunView,
} from '../types.ts'
import {
  aggregationProtocolIdentity,
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

export type ExperimentCombinationStatus = 'complete' | 'provisional'

/** One benchmark cell in a cross-iteration experiment combination row. */
export interface ExperimentBenchmarkCell {
  readonly benchmark: BenchmarkColumn
  readonly score: BenchmarkCombinationScore | null
  readonly baselineScore: number | null
  readonly delta: number | null
  readonly failure: string | null
}

/** One traceable iteration × candidate × Harness × Model × protocol row. */
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
  readonly protocolIdentity: string
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
  readonly benchmarks: readonly BenchmarkColumn[]
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
  'iterationId' | 'candidateId' | 'harnessId' | 'revision' | 'provider' | 'modelId' | 'protocolIdentity'>): string {
  return [
    score.iterationId,
    score.candidateId,
    harnessIdentity(score),
    modelIdentity(score),
    score.protocolIdentity,
  ].join('\u0000')
}

function evidenceSignature(row: ExperimentCombinationRow): string {
  return row.cells.flatMap(cell => cell.score === null ? [] : [[
    cell.benchmark.key,
    ...cell.score.evaluationIds,
    ...cell.score.runIds,
  ].join('\u0000')]).sort().join('\u0001')
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
  const benchmarkMap = new Map<string, BenchmarkColumn>()
  for (const score of scores) {
    const key = benchmarkKey(score)
    benchmarkMap.set(key, { key, id: score.benchmarkId, revision: score.benchmarkRevision })
  }
  for (const evaluation of Object.values(evaluationHistory)) {
    for (const item of evaluation.evaluations) {
      const key = benchmarkKey(item.ref)
      benchmarkMap.set(key, { key, id: item.ref.benchmarkId, revision: item.ref.benchmarkRevision })
    }
  }
  const benchmarks = [...benchmarkMap.values()]
    .sort((left, right) => left.id.localeCompare(right.id) || left.revision.localeCompare(right.revision))
  const iterationById = new Map(iterations.map(iteration => [iteration.id, iteration]))
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const groups = new Map<string, BenchmarkCombinationScore[]>()
  for (const score of scores) {
    const key = rowIdentity(score)
    const group = groups.get(key) ?? []
    group.push(score)
    groups.set(key, group)
  }

  const scoreRows = [...groups.entries()].map(([key, group]): ExperimentCombinationRow => {
    const first = group[0] as BenchmarkCombinationScore
    const resolvedModel = group.find(score => score.modelResolved) ?? first
    const iteration = iterationById.get(first.iterationId)
    const candidate = candidateById.get(first.candidateId)
    const cells = benchmarks.map((benchmark): ExperimentBenchmarkCell => {
      const score = group.find(item => benchmarkKey(item) === benchmark.key) ?? null
      const baseline = score === null ? null : baselineFor(scores, score, baselineCandidateId)
      const baselineScore = baseline?.mean ?? null
      const delta = score === null || baselineScore === null
        ? null
        : score.candidateId === baselineCandidateId ? 0 : score.mean - baselineScore
      return { benchmark, score, baselineScore, delta, failure: null }
    })
    const available = cells.flatMap(cell => cell.score === null ? [] : [cell.score])
    const deltas = cells.flatMap(cell => cell.delta === null ? [] : [cell.delta])
    const durationWeight = available.reduce((sum, score) => sum + (score.meanDurationMs === null ? 0 : score.runCount), 0)
    const provisional = available.some(score => score.provisional) || available.length < benchmarks.length
    const single = benchmarks.length === 1 ? available[0] : undefined
    return {
      key,
      iterationId: first.iterationId,
      iterationOrdinal: iteration?.ordinal ?? 0,
      iterationStatus: iteration?.status ?? 'failed',
      directionSummary: candidate?.directionSummary ?? iteration?.directionSummary ?? null,
      candidateId: first.candidateId,
      candidateLabel: candidate?.label ?? String(first.candidateId),
      candidateRole: candidate?.role ?? 'candidate',
      harness: { key: harnessIdentity(first), id: first.harnessId, revision: first.revision },
      model: {
        key: modelIdentity(resolvedModel), id: resolvedModel.modelId, provider: resolvedModel.provider,
        resolved: resolvedModel.modelResolved,
      },
      protocolIdentity: first.protocolIdentity,
      cells,
      meanScore: mean(available.map(score => score.mean)),
      meanDelta: first.candidateId === baselineCandidateId ? 0 : mean(deltas),
      meanDurationMs: durationWeight === 0 ? null : available.reduce((sum, score) => (
        sum + (score.meanDurationMs ?? 0) * score.runCount
      ), 0) / durationWeight,
      coverageCompleted: benchmarks.length === 1 ? single?.taskCount ?? 0 : available.length,
      coverageTotal: benchmarks.length === 1 ? single?.plannedTaskCount ?? null : benchmarks.length,
      validRuns: available.reduce((sum, score) => sum + score.runCount, 0),
      status: provisional ? 'provisional' : 'complete',
    }
  })
  const uniqueScoreRows = new Map<string, ExperimentCombinationRow>()
  for (const row of [...scoreRows].sort((left, right) => left.iterationOrdinal - right.iterationOrdinal)) {
    const signature = evidenceSignature(row)
    if (!uniqueScoreRows.has(signature)) uniqueScoreRows.set(signature, row)
  }
  const rows = [...uniqueScoreRows.values()].sort((left, right) => {
    const statusRank = { complete: 0, provisional: 1 } as const
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
  readonly runs: readonly RefinementRunView[]
  readonly selectableRunIds: readonly HitchRunId[]
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
    && aggregationProtocolIdentity(run.protocolIdentity) === column.protocolIdentity
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
  const columns = table.rows.filter(row => selected.has(row.key)
    && row.cells.some(cell => cell.benchmark.key === selectedBenchmarkKey && cell.score !== null))
    .sort((left, right) => left.iterationOrdinal - right.iterationOrdinal)
  const runGroups = new Map<string, RefinementRunView[]>()
  for (const column of columns) {
    const evaluation = evaluationHistory[column.iterationId]
    const runs = evaluation?.evaluations
      .filter(item => item.ref.failedEvaluation === undefined && benchmarkKey(item.ref) === selectedBenchmarkKey)
      .flatMap(item => item.runs.filter(run => runMatchesColumn(run, column))) ?? []
    runGroups.set(column.key, runs)
  }
  const tasks = new Map<string, string>()
  for (const runs of runGroups.values()) for (const run of runs) tasks.set(run.taskKey, run.taskId)
  const rows = [...tasks.entries()].map(([taskKey, taskId]): ExperimentTaskRow => {
    const cells = columns.map((column): ExperimentTaskCell => {
      const runs = (runGroups.get(column.key) ?? []).filter(run => run.taskKey === taskKey)
        .sort((left, right) => left.attempt - right.attempt)
      const rewards = runs.flatMap(run => run.integrity === 'valid' && run.observation.state === 'valid'
        ? [run.observation.reward] : [])
      return {
        columnKey: column.key,
        mean: mean(rewards),
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
