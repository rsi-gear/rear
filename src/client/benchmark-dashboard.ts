import type {
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementEvaluationView,
  RefinementIterationId,
} from '../types.ts'

/** Raw reward decrease that fails the default per-benchmark guardrail. */
export const BENCHMARK_REGRESSION_GUARDRAIL = 0.01

/** One candidate/harness/model result for one exact benchmark revision. */
export interface BenchmarkCombinationScore {
  readonly key: string
  readonly iterationId: RefinementIterationId
  readonly candidateId: RefinementCandidateId
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  readonly harnessId: string
  readonly harnessRef: string
  readonly revision: string | null
  readonly modelId: string
  readonly provider: string | null
  readonly protocolIdentity: string
  readonly mean: number
  readonly meanDurationMs: number | null
  readonly taskCount: number
  readonly plannedTaskCount: number | null
  readonly runCount: number
  readonly provisional: boolean
}

/** Stable identity used by dashboard selection and matrix columns. */
export function benchmarkKey(value: { readonly benchmarkId: string; readonly benchmarkRevision: string }): string {
  return `${value.benchmarkId}\u0000${value.benchmarkRevision}`
}

/** Aggregate valid observations without allowing repeated attempts to overweight one task. */
export function combinationScores(
  iterationId: RefinementIterationId,
  evaluation: RefinementEvaluationView | null,
): readonly BenchmarkCombinationScore[] {
  if (evaluation === null) return []
  const groups = new Map<string, {
    candidateId: RefinementCandidateId
    benchmarkId: string
    benchmarkRevision: string
    harnessId: string
    harnessRef: string
    revision: string | null
    modelId: string
    provider: string | null
    protocolIdentity: string
    tasks: Map<string, number[]>
    plannedTaskCounts: number[]
    durations: number[]
    runCount: number
  }>()
  for (const item of evaluation.evaluations) {
    for (const run of item.runs) {
      if (run.integrity !== 'valid' || run.observation.state !== 'valid') continue
      const modelId = run.model.effectiveId ?? run.model.requestedId
      const key = [
        run.candidateId,
        item.ref.benchmarkId,
        item.ref.benchmarkRevision,
        run.harness.id,
        run.harness.revisionIdentity ?? '',
        modelId,
        run.protocolIdentity,
      ].join('\u0000')
      const group = groups.get(key) ?? {
        candidateId: run.candidateId,
        benchmarkId: item.ref.benchmarkId,
        benchmarkRevision: item.ref.benchmarkRevision,
        harnessId: run.harness.id,
        harnessRef: run.harness.requestedRef,
        revision: run.harness.revisionIdentity,
        modelId,
        provider: run.model.provider,
        protocolIdentity: run.protocolIdentity,
        tasks: new Map<string, number[]>(),
        plannedTaskCounts: [],
        durations: [],
        runCount: 0,
      }
      const rewards = group.tasks.get(run.taskKey) ?? []
      rewards.push(run.observation.reward)
      group.tasks.set(run.taskKey, rewards)
      if (item.plannedTasks !== null) group.plannedTaskCounts.push(item.plannedTasks)
      if (run.startedAt !== undefined && run.completedAt !== undefined && run.completedAt >= run.startedAt) {
        group.durations.push(run.completedAt - run.startedAt)
      }
      group.runCount += 1
      groups.set(key, group)
    }
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const taskMeans = [...group.tasks.values()].map(rewards => rewards.reduce((sum, value) => sum + value, 0) / rewards.length)
    if (taskMeans.length === 0) return []
    const plannedTaskCount = group.plannedTaskCounts.length === 0 ? null : Math.max(...group.plannedTaskCounts)
    return [{
      key,
      iterationId,
      candidateId: group.candidateId,
      benchmarkId: group.benchmarkId,
      benchmarkRevision: group.benchmarkRevision,
      harnessId: group.harnessId,
      harnessRef: group.harnessRef,
      revision: group.revision,
      modelId: group.modelId,
      provider: group.provider,
      protocolIdentity: group.protocolIdentity,
      mean: taskMeans.reduce((sum, value) => sum + value, 0) / taskMeans.length,
      meanDurationMs: group.durations.length === 0
        ? null
        : group.durations.reduce((sum, value) => sum + value, 0) / group.durations.length,
      taskCount: taskMeans.length,
      plannedTaskCount,
      runCount: group.runCount,
      provisional: plannedTaskCount === null || taskMeans.length < plannedTaskCount,
    }]
  }).sort((left, right) => Number(left.provisional) - Number(right.provisional)
    || right.mean - left.mean
    || right.taskCount - left.taskCount)
}

export interface BenchmarkColumn {
  readonly key: string
  readonly id: string
  readonly revision: string
}

export interface BenchmarkPortfolioCell {
  readonly benchmark: BenchmarkColumn
  readonly score: BenchmarkCombinationScore | null
  readonly baselineScore: number | null
  readonly delta: number | null
  readonly status: 'baseline' | 'improved' | 'regressed' | 'unchanged' | 'missing'
  readonly guardrailViolation: boolean
}

export interface BenchmarkPortfolioRow {
  readonly candidateId: RefinementCandidateId
  readonly label: string
  readonly role: RefinementCandidateRecord['role']
  readonly cells: readonly BenchmarkPortfolioCell[]
  readonly benchmarkCoverage: number
  readonly meanScore: number | null
  readonly meanDelta: number | null
  readonly meanDurationMs: number | null
  readonly validRuns: number
  readonly pareto: boolean
}

export interface BenchmarkPortfolio {
  readonly benchmarks: readonly BenchmarkColumn[]
  readonly rows: readonly BenchmarkPortfolioRow[]
  readonly leadingRow: BenchmarkPortfolioRow | null
  readonly guardrailChecks: number
  readonly guardrailViolations: number
  readonly validRuns: number
}

function paretoIds(rows: readonly Omit<BenchmarkPortfolioRow, 'pareto'>[]): ReadonlySet<RefinementCandidateId> {
  const complete = rows.filter(row => row.meanScore !== null && row.meanDurationMs !== null)
  return new Set(complete.filter(row => !complete.some(other => other.candidateId !== row.candidateId
    && other.meanScore !== null
    && other.meanDurationMs !== null
    && row.meanScore !== null
    && row.meanDurationMs !== null
    && other.meanScore >= row.meanScore
    && other.meanDurationMs <= row.meanDurationMs
    && (other.meanScore > row.meanScore || other.meanDurationMs < row.meanDurationMs)))
    .map(row => row.candidateId))
}

/** Build the dashboard matrix, guardrail summary, and quality/latency Pareto set. */
export function benchmarkPortfolio(
  scores: readonly BenchmarkCombinationScore[],
  candidates: readonly RefinementCandidateRecord[],
  baselineCandidateId: RefinementCandidateId | null,
): BenchmarkPortfolio {
  const benchmarks = [...new Map(scores.map(score => {
    const key = benchmarkKey(score)
    return [key, { key, id: score.benchmarkId, revision: score.benchmarkRevision }]
  })).values()].sort((left, right) => left.id.localeCompare(right.id) || left.revision.localeCompare(right.revision))
  const bestByCandidateBenchmark = new Map<string, BenchmarkCombinationScore>()
  for (const score of scores) {
    const key = `${score.candidateId}\u0000${benchmarkKey(score)}`
    const current = bestByCandidateBenchmark.get(key)
    if (current === undefined
      || Number(score.provisional) < Number(current.provisional)
      || (score.provisional === current.provisional && score.mean > current.mean)) {
      bestByCandidateBenchmark.set(key, score)
    }
  }
  const activeCandidateIds = new Set(scores.map(score => score.candidateId))
  const activeCandidates = candidates.filter(candidate => activeCandidateIds.has(candidate.id))
    .sort((left, right) => Number(left.role !== 'baseline') - Number(right.role !== 'baseline') || left.createdAt - right.createdAt)
  const baselineScores = new Map(benchmarks.map(benchmark => [
    benchmark.key,
    baselineCandidateId === null
      ? null
      : bestByCandidateBenchmark.get(`${baselineCandidateId}\u0000${benchmark.key}`)?.mean ?? null,
  ]))
  const baseRows: Omit<BenchmarkPortfolioRow, 'pareto'>[] = activeCandidates.map((candidate) => {
    const cells: BenchmarkPortfolioCell[] = benchmarks.map((benchmark) => {
      const score = bestByCandidateBenchmark.get(`${candidate.id}\u0000${benchmark.key}`) ?? null
      const baselineScore = baselineScores.get(benchmark.key) ?? null
      const delta = candidate.id === baselineCandidateId || score === null || baselineScore === null
        ? candidate.id === baselineCandidateId && score !== null ? 0 : null
        : score.mean - baselineScore
      const status = score === null
        ? 'missing'
        : candidate.id === baselineCandidateId
          ? 'baseline'
          : delta === null || Math.abs(delta) < 0.0005
            ? 'unchanged'
            : delta > 0 ? 'improved' : 'regressed'
      return {
        benchmark,
        score,
        baselineScore,
        delta,
        status,
        guardrailViolation: candidate.id !== baselineCandidateId
          && delta !== null
          && delta < -BENCHMARK_REGRESSION_GUARDRAIL,
      }
    })
    const available = cells.flatMap(cell => cell.score === null ? [] : [cell.score])
    const comparableDeltas = cells.flatMap(cell => candidate.id === baselineCandidateId || cell.delta === null ? [] : [cell.delta])
    const durationWeight = available.reduce((sum, score) => sum + (score.meanDurationMs === null ? 0 : score.runCount), 0)
    return {
      candidateId: candidate.id,
      label: candidate.label,
      role: candidate.role,
      cells,
      benchmarkCoverage: available.length,
      meanScore: available.length === 0 ? null : available.reduce((sum, score) => sum + score.mean, 0) / available.length,
      meanDelta: comparableDeltas.length === 0 ? candidate.id === baselineCandidateId ? 0 : null : comparableDeltas.reduce((sum, value) => sum + value, 0) / comparableDeltas.length,
      meanDurationMs: durationWeight === 0
        ? null
        : available.reduce((sum, score) => sum + (score.meanDurationMs ?? 0) * score.runCount, 0) / durationWeight,
      validRuns: available.reduce((sum, score) => sum + score.runCount, 0),
    }
  })
  const pareto = paretoIds(baseRows)
  const rows = baseRows.map(row => ({ ...row, pareto: pareto.has(row.candidateId) }))
  const candidateCells = rows.flatMap(row => row.role === 'baseline' ? [] : row.cells)
  const comparableCells = candidateCells.filter(cell => cell.delta !== null)
  const leadingRow = rows.filter(row => row.role !== 'baseline' && row.meanScore !== null)
    .sort((left, right) => (right.benchmarkCoverage - left.benchmarkCoverage)
      || ((right.meanScore ?? Number.NEGATIVE_INFINITY) - (left.meanScore ?? Number.NEGATIVE_INFINITY)))[0] ?? null
  return {
    benchmarks,
    rows,
    leadingRow,
    guardrailChecks: comparableCells.length,
    guardrailViolations: comparableCells.filter(cell => cell.guardrailViolation).length,
    validRuns: rows.reduce((sum, row) => sum + row.validRuns, 0),
  }
}
