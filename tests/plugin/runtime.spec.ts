import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import RefinementRuntime from '../../src/runtime.ts'
import type {
  RefinementDriver,
  RefinementDriverOperation,
  RefinementEvidenceProvider,
} from '../../src/providers.ts'

interface Harness {
  readonly ctx: Context
  readonly root: string
}

const harnesses: Harness[] = []

afterEach(async () => {
  const cleanup = harnesses.splice(0)
  await Promise.all(cleanup.map(({ ctx }) => ctx.fiber.dispose()))
  await Promise.all([...new Set(cleanup.map(({ root }) => root))]
    .map(root => rm(root, { recursive: true, force: true })))
})

async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-refinement-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(RefinementRuntime, {
    driver: 'fixture-driver',
    evidenceProvider: 'fixture-evidence',
    objectiveMaxBytes: 64,
    trajectoryResponseMaxBytes: 65_536,
    providerEvidencePageMaxBytes: 4_096,
  })
  const value = { ctx, root }
  harnesses.push(value)
  return value
}

async function persistentHarness(root: string, sessionId: ReturnType<typeof SessionId>): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.sessions.create(sessionId, { meta: { createdAt: 42, cwd: '/fixture' } })
  await ctx.plugin(RefinementRuntime, {
    driver: 'fixture-driver',
    evidenceProvider: 'fixture-evidence',
    objectiveMaxBytes: 64,
    trajectoryResponseMaxBytes: 65_536,
    providerEvidencePageMaxBytes: 4_096,
  })
  const value = { ctx, root }
  harnesses.push(value)
  return value
}

function provider(): RefinementEvidenceProvider {
  return {
    id: 'fixture-evidence',
    available: () => true,
    evaluation: vi.fn(() => Promise.reject(new Error('unused'))),
    compare: vi.fn(() => Promise.reject(new Error('unused'))),
    trajectory: vi.fn(() => Promise.reject(new Error('unused'))),
    providerEvidence: vi.fn(() => Promise.reject(new Error('unused'))),
    watch: vi.fn(() => () => {}),
  }
}

function driver(captured: RefinementDriverOperation[], settle: Promise<void>): RefinementDriver {
  return {
    id: 'fixture-driver',
    available: () => true,
    run: vi.fn(async (operation: RefinementDriverOperation) => {
      captured.push(operation)
      await settle
    }),
    resume: vi.fn(async (operation: RefinementDriverOperation) => {
      captured.push(operation)
      await settle
    }),
    cancel: vi.fn(async () => 'stopped' as const),
  }
}

describe('RefinementRuntime', () => {
  it('requires the configured providers and rejects duplicate provider ids', async () => {
    const { ctx } = await harness()
    const session = ctx.sessions.create(SessionId('provider-selection'))
    const agent = { session } as Agent
    await expect(ctx.refinements.start(agent, { objective: null }, new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'driver-unavailable' },
    })
    const evidence = provider()
    const dispose = ctx.refinements.registerEvidenceProvider(evidence)
    expect(() => ctx.refinements.registerEvidenceProvider(evidence)).toThrow(/already registered/u)
    dispose()
  })

  it('admits before driver settlement, appends one link, serializes CAS mutations, and rejects terminal writes', async () => {
    const { ctx } = await harness()
    const captured: RefinementDriverOperation[] = []
    const settlement = Promise.withResolvers<undefined>()
    ctx.refinements.registerEvidenceProvider(provider())
    ctx.refinements.registerDriver(driver(captured, settlement.promise))
    const session = ctx.sessions.create(SessionId('admission'))
    const result = await ctx.refinements.start(
      { session } as Agent,
      { objective: 'reduce regressions' },
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(session.events.filter(event => event.type === 'refinement/created')).toHaveLength(1)
    await vi.waitFor(() => { expect(captured).toHaveLength(1) })
    const operation = captured[0] as RefinementDriverOperation
    const first = await operation.capabilities.addCandidate(operation.record.version, {
      role: 'baseline',
      parentCandidateId: null,
      requestedHarnessRef: 'baseline',
      revisionIdentity: 'baseline-rev',
      label: 'Baseline',
    })
    await expect(operation.capabilities.addCandidate(operation.record.version, {
      role: 'candidate',
      parentCandidateId: null,
      requestedHarnessRef: 'stale',
      revisionIdentity: null,
      label: 'Stale',
    })).rejects.toThrow(/version conflict/u)
    const terminal = await operation.capabilities.finish(first.version, 'completed')
    await expect(operation.capabilities.addCandidate(terminal.version, {
      role: 'candidate',
      parentCandidateId: first.candidates[0]?.id ?? null,
      requestedHarnessRef: 'late',
      revisionIdentity: null,
      label: 'Late',
    })).rejects.toThrow(/terminal/u)
    settlement.resolve(undefined)
  })

  it('hides an old sidecar when the same Session id starts a new lifecycle', async () => {
    const { ctx } = await harness()
    const captured: RefinementDriverOperation[] = []
    const settlement = Promise.withResolvers<undefined>()
    ctx.refinements.registerEvidenceProvider(provider())
    ctx.refinements.registerDriver(driver(captured, settlement.promise))
    const id = SessionId('reused-session')
    let firstSession: ReturnType<typeof ctx.sessions.create> | undefined
    const createFirst = Object.assign(
      (child: Context): void => { firstSession = child.sessions.create(id, { meta: { createdAt: 1 } }) },
      { inject: ['sessions'] },
    )
    const firstFiber = await ctx.plugin(createFirst)
    const started = await ctx.refinements.start(
      { session: firstSession } as unknown as Agent,
      { objective: null },
      new AbortController().signal,
    )
    if (!started.ok) throw new Error(started.error.message)
    await firstFiber.dispose()
    const createSecond = Object.assign(
      (child: Context): void => { child.sessions.create(id, { meta: { createdAt: 2 } }) },
      { inject: ['sessions'] },
    )
    await ctx.plugin(createSecond)
    expect(ctx.refinements.list({ sessionId: id })).toEqual({ ok: true, value: { records: [] } })
    expect(ctx.refinements.get({ sessionId: id, refinementId: started.value.refinementId })).toMatchObject({
      ok: false,
      error: { code: 'refinement-not-found' },
    })
    settlement.resolve(undefined)
  })

  it('rebuilds the Session index and resumes a persisted non-terminal operation after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-refinement-restart-'))
    const sessionId = SessionId('restart-session')
    const first = await persistentHarness(root, sessionId)
    const startedOperations: RefinementDriverOperation[] = []
    first.ctx.refinements.registerEvidenceProvider(provider())
    first.ctx.refinements.registerDriver({
      id: 'fixture-driver',
      available: () => true,
      run: vi.fn(async (operation: RefinementDriverOperation) => {
        startedOperations.push(operation)
        await operation.capabilities.setOperationId(operation.record.version, 'external-operation')
        await new Promise<void>((resolve) => {
          operation.signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      }),
      resume: vi.fn(() => Promise.reject(new Error('unused'))),
      cancel: vi.fn(async () => 'stopped' as const),
    })
    const session = first.ctx.sessions.get(sessionId)
    if (session === undefined) throw new Error('restart fixture Session was not created')
    const started = await first.ctx.refinements.start(
      { session } as Agent,
      { objective: 'persist me' },
      new AbortController().signal,
    )
    if (!started.ok) throw new Error(started.error.message)
    await vi.waitFor(() => {
      expect(first.ctx.refinements.get({ sessionId, refinementId: started.value.refinementId })).toMatchObject({
        ok: true,
        value: { status: 'running', driver: { operationId: 'external-operation' } },
      })
    })
    await first.ctx.fiber.dispose()

    const second = await persistentHarness(root, sessionId)
    const resumed: RefinementDriverOperation[] = []
    second.ctx.refinements.registerEvidenceProvider(provider())
    second.ctx.refinements.registerDriver({
      id: 'fixture-driver',
      available: () => true,
      run: vi.fn(() => Promise.reject(new Error('unused'))),
      resume: vi.fn(async (operation: RefinementDriverOperation) => {
        resumed.push(operation)
        await operation.capabilities.finish(operation.record.version, 'completed')
      }),
      cancel: vi.fn(async () => 'stopped' as const),
    })
    await vi.waitFor(() => {
      expect(second.ctx.refinements.list({ sessionId })).toMatchObject({
        ok: true,
        value: { records: [{ id: started.value.refinementId, status: 'completed' }] },
      })
    })
    expect(startedOperations).toHaveLength(1)
    expect(resumed).toHaveLength(1)
    expect(resumed[0]?.agent).toBeNull()
    expect(resumed[0]?.record.driver.operationId).toBe('external-operation')
  })
})
