import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HitchRefinementEvidenceProvider } from '../../src/hitch-provider.ts'
import RefinementRuntime from '../../src/runtime.ts'
import type { RefinementId, RefinementIterationId } from '../../src/types.ts'

interface FixtureManifest {
  readonly session: { readonly id: string; readonly createdAt: number; readonly cwd: string }
  readonly primaryRefinementId: string
}

const fixtureRoot = fileURLToPath(new URL('../../fixtures/dashboard-data/', import.meta.url))
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('mountable dashboard fixture', () => {
  it('loads through the real durable domain and exposes rich Hitch evidence', async () => {
    const manifest = JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8')) as FixtureManifest
    context = new Context()
    await context.plugin(SessionStore)
    await context.plugin(Storage)
    await context.plugin(StorageJson, { root: join(fixtureRoot, 'storage') })
    await context.plugin(StorageDomain, { backend: 'json' })
    context.sessions.create(SessionId(manifest.session.id), {
      meta: { createdAt: manifest.session.createdAt, cwd: manifest.session.cwd },
    })
    await context.plugin(RefinementRuntime, {
      driver: 'dashboard-fixture-driver',
      evidenceProvider: 'hitch',
      objectiveMaxBytes: 16_384,
      trajectoryResponseMaxBytes: 8_388_608,
      providerEvidencePageMaxBytes: 4_096,
    })
    const provider = new HitchRefinementEvidenceProvider({
      id: 'hitch', root: join(fixtureRoot, 'hitch'), watchDebounceMs: 5,
    })
    const current = context
    current.effect(() => current.refinements.registerEvidenceProvider(provider))

    const sessionId = SessionId(manifest.session.id)
    const listed = context.refinements.list({ sessionId })
    expect(listed).toMatchObject({
      ok: true,
      value: {
        records: [
          { id: manifest.primaryRefinementId, status: 'completed', iterationCount: 2 },
          { status: 'failed' },
          { status: 'cancelled' },
        ],
      },
    })
    if (!listed.ok) throw new Error(listed.error.message)

    const detail = context.refinements.get({
      sessionId,
      refinementId: manifest.primaryRefinementId as RefinementId,
    })
    if (!detail.ok) throw new Error(detail.error.message)
    const iterationId = detail.value.iterations.at(-1)?.id as RefinementIterationId
    const evaluated = await context.refinements.evaluation({
      sessionId,
      refinementId: detail.value.id,
      iterationId,
      dimension: 'harness',
      referenceRunId: null,
    })
    if (!evaluated.ok) throw new Error(evaluated.error.message)
    expect(evaluated.value.comparison.strict).toBe(true)
    expect(evaluated.value.comparison.tasks.map(task => task.status)).toEqual([
      'regressed', 'improved', 'improved', 'unchanged',
    ])
    const runs = evaluated.value.evaluations.flatMap(item => item.runs)
    expect(new Set(runs.map(run => run.trajectory.availability))).toEqual(new Set([
      'available', 'provider-only', 'missing', 'corrupt',
    ]))

    const canonicalRun = runs.find(run => run.trajectory.hasCanonical && run.trajectory.providerFileCount > 0)
    if (canonicalRun === undefined) throw new Error('fixture has no canonical + provider run')
    const trajectory = await context.refinements.trajectory({
      sessionId, refinementId: detail.value.id, runId: canonicalRun.id,
    })
    expect(trajectory).toMatchObject({ ok: true, value: { runId: canonicalRun.id } })

    const largeRawRun = runs.find(run => run.evalId === 'eval_dashboard_quality_v2'
      && run.taskId === 'json-schema-repair' && run.attempt === 1)
    if (largeRawRun === undefined) throw new Error('fixture has no paged raw evidence run')
    const page = await context.refinements.providerEvidence({
      sessionId,
      refinementId: detail.value.id,
      runId: largeRawRun.id,
      fileOrdinal: 0,
      cursor: null,
    })
    expect(page).toMatchObject({ ok: true, value: { encoding: 'utf8' } })
    if (!page.ok) throw new Error(page.error.message)
    expect(page.value.nextCursor).not.toBeNull()
    expect(page.value.content).toContain('可用于测试分页')
  })
})
