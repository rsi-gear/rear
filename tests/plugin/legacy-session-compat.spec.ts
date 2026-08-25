import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
} from '@deepseek-ai/dsh-session'
import {
  PersistenceCoordinator,
  SessionPersistenceRevision,
  type PersistenceBackend,
} from '@deepseek-ai/dsh-session-persistence'
import '../../src/runtime.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(context => context.fiber.dispose()))
})

describe('legacy Rear Session compatibility', () => {
  it('loads an unmarked refinement/created event written by pre-Gear Rear', async () => {
    const id = SessionId('legacy-rear-session')
    const meta: SessionHeader = {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 42,
      cwd: '/fixture',
    }
    const event = {
      type: 'refinement/created',
      seq: 0,
      time: 43,
      data: { refinementId: 'legacy-refinement-id' },
    } as unknown as SessionEvent
    const revision = SessionPersistenceRevision('legacy-rear:1')
    const backend: PersistenceBackend = {
      name: 'legacy-rear-fixture',
      async loadStored(requestedId) {
        if (requestedId !== id) return undefined
        return structuredClone({ meta, events: [event], revision })
      },
      async readStoredRevision(requestedId) {
        return requestedId === id ? revision : undefined
      },
      async appendBatch() {
        throw new Error('legacy compatibility inspection must not write')
      },
      async commitRepair() {},
      async list() {
        return [structuredClone(meta)]
      },
    }
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionStore)
    const persistence = new PersistenceCoordinator(ctx, backend, {
      preparedSessionCacheSize: 1,
      writeBatchMaxDelayMs: 1,
    })

    const inspected = await persistence.inspect(id)

    expect(inspected.events).toHaveLength(1)
    expect(inspected.events[0]).toMatchObject({
      type: 'refinement/created',
      data: { refinementId: 'legacy-refinement-id' },
    })
    expect(inspected.events[0]).not.toHaveProperty('ignorable')
  })
})
