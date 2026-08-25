import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HitchRefinementEvidenceProvider } from '../../src/hitch-provider.ts'
import type { RefinementEvaluationView, RefinementRecordV1 } from '../../src/types.ts'
import { benchmarkPortfolio, combinationScores } from '../../src/client/benchmark-dashboard.ts'

interface FixtureManifest {
  readonly primaryRefinementId: string
  readonly benchmarks: readonly { readonly id: string; readonly revision: string }[]
}

interface FixtureStorage {
  readonly tables: { readonly refinements: Record<string, RefinementRecordV1> }
}

const run = promisify(execFile)
const fixtureGenerator = fileURLToPath(new URL('../../scripts/generate-dashboard-fixture.mjs', import.meta.url))
let fixtureRoot = ''

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'rear-dashboard-fixture-'))
  await run(process.execPath, [fixtureGenerator, '--output', fixtureRoot])
})

afterAll(async () => {
  if (fixtureRoot !== '') await rm(fixtureRoot, { recursive: true, force: true })
})

describe('dashboard evidence fixture', () => {
  it('exposes rich Hitch evidence without a Rear lifecycle sidecar service', async () => {
    const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8')) as FixtureManifest
    const storage = JSON.parse(await readFile(join(fixtureRoot, 'storage', 'refinement.json'), 'utf8')) as FixtureStorage
    expect(manifest.benchmarks.map(item => item.id).sort()).toEqual([
      'long-context-retrieval',
      'rear-dashboard-benchmark',
      'tool-use-safety',
    ])
    const detail = storage.tables.refinements[manifest.primaryRefinementId]
    if (detail === undefined) throw new Error('fixture primary refinement is absent')
    const selectedIteration = detail.iterations.at(-1)
    if (selectedIteration === undefined) throw new Error('fixture has no selected iteration')
    const provider = new HitchRefinementEvidenceProvider({
      id: 'hitch', root: join(fixtureRoot, 'hitch'), watchDebounceMs: 5,
    })
    const evaluations = await Promise.all(selectedIteration.evaluationRefs.map(ref => provider.evaluation(ref)))
    const comparison = await provider.compare({
      refs: selectedIteration.evaluationRefs,
      dimension: 'harness',
      referenceRunId: null,
    })
    const evaluated: RefinementEvaluationView = {
      evidenceVersion: 'fixture',
      evaluations,
      comparison,
    }
    expect(evaluated.comparison.strict).toBe(true)
    expect(new Set(evaluated.evaluations.map(item => item.ref.benchmarkId))).toEqual(new Set([
      'rear-dashboard-benchmark', 'tool-use-safety', 'long-context-retrieval',
    ]))
    const comparisonByTask = new Map(evaluated.comparison.tasks.map(task => [task.taskId, task.status]))
    expect(comparisonByTask.get('unicode-paths')).toBe('regressed')
    expect(comparisonByTask.get('destructive-guard')).toBe('regressed')
    expect(comparisonByTask.get('cross-file-trace')).toBe('improved')
    expect(comparisonByTask.get('retry-backoff')).toBe('unchanged')
    const portfolio = benchmarkPortfolio(
      combinationScores(selectedIteration.id, evaluated),
      detail.candidates,
      detail.baselineCandidateId,
    )
    expect(portfolio.benchmarks).toHaveLength(3)
    expect(portfolio.guardrailViolations).toBe(1)
    expect(portfolio.leadingRow?.candidateId).toBe('candidate-dashboard-quality-v2')
    const runs = evaluated.evaluations.flatMap(item => item.runs)
    expect(new Set(runs.map(item => item.trajectory.availability))).toEqual(new Set([
      'available', 'provider-only', 'missing', 'corrupt',
    ]))

    const canonicalRun = runs.find(item => item.trajectory.hasCanonical && item.trajectory.providerFileCount > 0)
    if (canonicalRun === undefined) throw new Error('fixture has no canonical + provider run')
    const canonicalRef = selectedIteration.evaluationRefs.find(ref => ref.evalId === canonicalRun.evalId)
    if (canonicalRef === undefined) throw new Error('fixture canonical run has no eval ref')
    await expect(provider.trajectory({ evalRef: canonicalRef, runId: canonicalRun.id })).resolves.toMatchObject({
      runId: canonicalRun.id,
    })

    const largeRawRun = runs.find(item => item.evalId === 'eval_dashboard_quality_v2'
      && item.taskId === 'json-schema-repair' && item.attempt === 1)
    if (largeRawRun === undefined) throw new Error('fixture has no paged raw evidence run')
    const rawRef = selectedIteration.evaluationRefs.find(ref => ref.evalId === largeRawRun.evalId)
    if (rawRef === undefined) throw new Error('fixture raw run has no eval ref')
    const page = await provider.providerEvidence({
      evalRef: rawRef,
      runId: largeRawRun.id,
      fileOrdinal: 0,
      cursor: null,
      maxBytes: 4_096,
    })
    expect(page.encoding).toBe('utf8')
    expect(page.nextCursor).not.toBeNull()
    expect(page.content).toContain('可用于测试分页')
  })
})
