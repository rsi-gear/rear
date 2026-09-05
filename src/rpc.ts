/** Generic DSH Connection RPC bridge for the independently published plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { transportError, type RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import { z } from 'zod'
import type { RefinementId } from './types.ts'
import type { RefinementRuntime } from './runtime.ts'

const session = z.string().min(1)
const refinement = z.string().min(1)
const run = z.string().min(1)
const getRequest = z.object({ sessionId: session, refinementId: refinement })

const schemas = {
  list: z.object({ sessionId: session }),
  get: getRequest,
  evaluation: getRequest.extend({
    iterationId: z.string().min(1),
    dimension: z.enum(['harness', 'model']),
    referenceRunId: run.nullable(),
  }),
  trajectory: getRequest.extend({ runId: run }),
  'trajectory-page': getRequest.extend({ runId: run, cursor: z.string().nullable() }),
  'provider-evidence': getRequest.extend({
    runId: run,
    fileOrdinal: z.number().int().nonnegative(),
    cursor: z.string().nullable(),
  }),
  'interaction-evidence': getRequest.extend({
    runId: run,
    cursor: z.string().nullable(),
  }),
  changes: z.object({ sessionId: session, after: z.string().nullable() }),
} as const

type Change = { readonly token: string; readonly refinementId: RefinementId }

/** One payload-free, event-driven invalidation wait per browser controller. */
class ChangeBroker {
  private readonly latest = new Map<string, Change>()
  private readonly waiters = new Map<string, Set<(change: Change) => void>>()

  constructor(private readonly waitMs: number) {}

  publish(sessionId: string, refinementId: RefinementId, token: string): void {
    const change = { token, refinementId }
    this.latest.set(sessionId, change)
    for (const resolve of this.waiters.get(sessionId) ?? []) resolve(change)
    this.waiters.delete(sessionId)
  }

  async wait(
    sessionId: string,
    after: string | null,
    signal: AbortSignal,
  ): Promise<{ readonly token: string | null; readonly refinementId: RefinementId | null }> {
    const current = this.latest.get(sessionId)
    if (current !== undefined && current.token !== after) return current
    return await new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const finish = (value: { readonly token: string | null; readonly refinementId: RefinementId | null }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', aborted)
        listeners.delete(changed)
        if (listeners.size === 0) this.waiters.delete(sessionId)
        resolve(value)
      }
      const changed = (change: Change): void => { finish(change) }
      const aborted = (): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        listeners.delete(changed)
        if (listeners.size === 0) this.waiters.delete(sessionId)
        reject(signal.reason instanceof Error ? signal.reason : new Error('refinement change wait aborted'))
      }
      let existingListeners = this.waiters.get(sessionId)
      if (existingListeners === undefined) {
        existingListeners = new Set()
        this.waiters.set(sessionId, existingListeners)
      }
      const listeners = existingListeners
      listeners.add(changed)
      timer = setTimeout(() => { finish({ token: after, refinementId: null }) }, this.waitMs)
      signal.addEventListener('abort', aborted, { once: true })
      if (signal.aborted) aborted()
    })
  }
}

/** Register all Host operations on a plugin-owned trusted Connection channel. */
export function mountRefinementRpc(
  ctx: Context,
  runtime: RefinementRuntime,
  changeWaitMs: number,
): void {
  if (!Number.isSafeInteger(changeWaitMs) || changeWaitMs < 1) {
    throw new TypeError('refinement: changeWaitMs must be a positive safe integer')
  }
  const broker = new ChangeBroker(changeWaitMs)
  ctx.effect(() => ctx.on('refinement/change', (sessionId, refinementId, token) => {
    broker.publish(sessionId, refinementId, token)
  }), 'refinement-rpc: change broker')

  const connection = ctx.get('connection') as HostConnectionHandle
  connection.rpc.handle('/refinement', async (endpoint, payload, signal): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case 'list': return { ok: true, value: runtime.list(schemas.list.parse(payload) as never) }
        case 'get': return { ok: true, value: runtime.get(schemas.get.parse(payload) as never) }
        case 'evaluation': return { ok: true, value: await runtime.evaluation(schemas.evaluation.parse(payload) as never) }
        case 'trajectory': return { ok: true, value: await runtime.trajectory(schemas.trajectory.parse(payload) as never) }
        case 'trajectory-page': return { ok: true, value: await runtime.trajectoryPage(schemas['trajectory-page'].parse(payload) as never) }
        case 'provider-evidence': return {
          ok: true,
          value: await runtime.providerEvidence(schemas['provider-evidence'].parse(payload) as never),
        }
        case 'interaction-evidence': return {
          ok: true,
          value: await runtime.interactionEvidence(schemas['interaction-evidence'].parse(payload) as never),
        }
        case 'changes': {
          const request = schemas.changes.parse(payload)
          const owned = runtime.list({ sessionId: request.sessionId as never })
          if (!owned.ok) throw new Error(owned.error.message)
          return { ok: true, value: await broker.wait(request.sessionId, request.after, signal) }
        }
        default: throw new Error(`unknown refinement RPC endpoint: ${endpoint}`)
      }
    } catch (error) {
      return transportError(error)
    }
  }, { authority: 'trusted-host' })
}
