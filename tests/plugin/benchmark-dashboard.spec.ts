import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_REGRESSION_GUARDRAIL,
  benchmarkPortfolio,
  type BenchmarkCombinationScore,
} from '../../src/client/benchmark-dashboard.ts'
import type {
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementIterationId,
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
    protocolIdentity: 'fixture-protocol',
    mean,
    meanDurationMs,
    taskCount: 4,
    plannedTaskCount: 4,
    runCount: 4,
    provisional: false,
  }
}

describe('benchmark portfolio dashboard', () => {
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
