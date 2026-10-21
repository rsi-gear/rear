import { describe, expect, it, vi } from 'vitest'
import { TraceAnalysisController, analysisScopeKey, type CreateTraceChat } from '../../src/client/analysis-controller.ts'
import type { TraceChatSession } from '../../src/trace-chat.ts'

const a = { refinementId: 'experiment', runIds: ['a', 'b'] }
const b = { refinementId: 'experiment', runIds: ['c'] }
const response = (runIds: readonly string[], sessionId = 'native-session'): TraceChatSession => ({ sessionId, directory: '/trace-chats/test', title: 'Trace chat', runIds })

describe('native trace-chat pane selection', () => {
  it('prepares one blank native session on first entry, without dispatching a question', async () => {
    const create = vi.fn<CreateTraceChat>(async request => response(request.runIds))
    const controller = new TraceAnalysisController(create, async () => [])
    await Promise.all([controller.ensure(a), controller.ensure(a)])
    await controller.ensure({ ...a, runIds: ['b', 'a'] })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toEqual({ ...a, requestId: expect.any(String) })
    expect(controller.conversation(a).session).toEqual(response(a.runIds))
    expect(controller.conversation(b).session).toBeUndefined()
    expect(analysisScopeKey(a)).toBe(analysisScopeKey({ ...a, runIds: ['b', 'a'] }))
  })

  it('reuses the request ID after failure, but creates a fresh session for New analysis', async () => {
    const sent: Parameters<CreateTraceChat>[0][] = []
    const controller = new TraceAnalysisController(async request => {
      sent.push(request)
      if (sent.length === 1) throw new Error('host unavailable')
      return response(request.runIds, request.requestId)
    }, async () => [])
    await controller.ensure(a)
    expect(controller.conversation(a).error).toBe('host unavailable')
    await controller.ensure(a)
    const first = controller.conversation(a).session!
    await controller.newChat(a)
    expect(sent[0]?.requestId).toBe(sent[1]?.requestId)
    expect(sent[2]?.requestId).not.toBe(sent[1]?.requestId)
    expect(controller.conversation(a).history).toHaveLength(2)
    controller.select(a, first.sessionId)
    expect(controller.conversation(a).session).toEqual(first)
  })

  it('keeps concurrent preparation in separate trace scopes and coalesces duplicate New actions', async () => {
    let resolve!: (value: TraceChatSession) => void
    const create = vi.fn<CreateTraceChat>(request => request.runIds.includes('a')
      ? new Promise(done => { resolve = done }) : Promise.resolve(response(request.runIds, 'other')))
    const controller = new TraceAnalysisController(create, async () => [])
    const pending = controller.newChat(a)
    await controller.newChat(a)
    await controller.ensure(b)
    resolve(response(a.runIds)); await pending
    expect(create).toHaveBeenCalledTimes(2)
    expect(controller.conversation(a).session?.sessionId).toBe('native-session')
    expect(controller.conversation(b).session?.sessionId).toBe('other')
  })

  it('does not create after disposal during history restore or publish after disposal during creation', async () => {
    let restore!: (chats: TraceChatSession[]) => void
    const create = vi.fn<CreateTraceChat>(async request => response(request.runIds))
    const controller = new TraceAnalysisController(create, () => new Promise(done => { restore = done }))
    const loading = controller.ensure(a)
    controller.dispose(); restore([]); await loading
    expect(create).not.toHaveBeenCalled()
    let resolve!: (value: TraceChatSession) => void
    const preparing = new TraceAnalysisController(() => new Promise(done => { resolve = done }), async () => [])
    const pending = preparing.newChat(a)
    preparing.dispose(); resolve(response(a.runIds)); await pending
    expect(preparing.conversation(a).session).toBeUndefined()
  })

  it('restores existing history without preparing another session, keeping experiments/run sets isolated', async () => {
    const saved = response(a.runIds), create = vi.fn()
    const list = vi.fn(async () => [saved])
    const controller = new TraceAnalysisController(create, list)
    await controller.ensure(a)
    await controller.ensure({ ...a, runIds: ['b', 'a'] })
    expect(list).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    expect(controller.conversation(a).session).toEqual(saved)
    expect(controller.conversation(b).history).toEqual([])
    expect(controller.conversation({ ...a, refinementId: 'other' }).session).toBeUndefined()
  })

  it('finishes history restore before allowing New, so a late restore cannot replace a new session', async () => {
    let restore!: (chats: TraceChatSession[]) => void
    const create = vi.fn<CreateTraceChat>(async () => response(a.runIds, 'new'))
    const controller = new TraceAnalysisController(create, () => new Promise(done => { restore = done }))
    const loading = controller.ensure(a)
    await controller.newChat(a)
    expect(create).not.toHaveBeenCalled()
    restore([response(a.runIds)]); await loading
    await controller.newChat(a)
    expect(controller.conversation(a).session?.sessionId).toBe('new')
    expect(controller.conversation(a).history).toHaveLength(2)
  })

  it('does not create on a failed history lookup or an empty selection', async () => {
    const create = vi.fn(), list = vi.fn(async () => { throw new Error('offline') })
    const controller = new TraceAnalysisController(create, list)
    await controller.ensure({ ...a, runIds: [] })
    expect(list).not.toHaveBeenCalled()
    await controller.ensure(a)
    expect(controller.conversation(a).error).toBe('offline')
    expect(create).not.toHaveBeenCalled()
  })
})
