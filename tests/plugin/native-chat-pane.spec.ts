import { describe, expect, it, vi } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionMaybeProvideInfo, SlotRendererHost, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { createNativeChatBridge, createPaneHost } from '../../src/client/DshNativeChatSurface.tsx'

const source = <T>(value: T) => ({ getSnapshot: () => value, subscribe: () => () => {} })
function fixture() {
  const header: StoredEntry = { component: () => null, options: {} }
  const views = { list: () => [{ id: 'chat' }, { id: 'trajectory' }, { id: 'refinement' }] }
  const body: StoredEntry = { component: () => null, options: {}, inject: () => ({ views }) }
  const chat: StoredEntry = { component: () => null, options: { id: 'chat' }, inject: () => ({ inspectCall: vi.fn() }) }
  const entries: Record<string, StoredEntry[]> = { 'conversation.session.header': [header], 'conversation.session': [body], 'conversation.view': [chat] }
  const host = {
    entriesOf: (key: string) => entries[key] ?? [], entriesOfSlot: (key: string) => entries[key] ?? [],
    isLive: () => true, storeOf: vi.fn(), reportEntryError: vi.fn(),
    sessions: { list: source({ current: 'parent' }), provideInfo: source({ sessionId: 'parent', hooks: {}, props: {} }) },
  } as unknown as SlotRendererHost
  return { host, body, chat, views }
}

describe('embedded native Chat assembly', () => {
  it('uses the child provide bundle and original stores without replacing global slots or selection', () => {
    const { host, views } = fixture()
    const info: SessionMaybeProvideInfo = { sessionId: 'analysis', hooks: { input: source({ draft: 'child draft' }) }, props: {} }
    const pane = createPaneHost(host, source(info))
    expect(pane.sessions.provideInfo.getSnapshot()).toBe(info)
    expect(host.sessions.provideInfo.getSnapshot().sessionId).toBe('parent')
    expect(pane.entriesOfSlot('conversation.session.header')).toEqual([])
    expect(host.entriesOfSlot('conversation.session.header')).toHaveLength(1)
    const body = pane.entriesOfSlot('conversation.session')[0]!
    const injected = body.inject!() as { views: typeof views }
    expect(injected.views.list()).toEqual([{ id: 'chat' }])
    expect(views.list()).toHaveLength(3)
    pane.storeOf(body, 'analysis')
    expect(host.storeOf).toHaveBeenCalledWith(host.entriesOfSlot('conversation.session')[0], 'analysis')
    pane.reportEntryError('conversation.view', body, new Error('pane failure'), { abdicate: true })
    expect(host.reportEntryError).not.toHaveBeenCalled()
  })

  it('routes native tool inspection to the analysis session details, without changing the main view', () => {
    const { host } = fixture(), select = vi.fn(), setView = vi.fn()
    const pane = createPaneHost(host, source({ sessionId: 'analysis', hooks: {}, props: {} }))
    const inject = pane.entriesOfSlot('conversation.view')[0]!.inject as (...args: unknown[]) => { inspectCall(id: string): void }
    inject('analysis', { select, setView }).inspectCall('tool-42')
    expect(select).toHaveBeenCalledWith({ callId: 'tool-42' })
    expect(setView).not.toHaveBeenCalled()
  })

  it('keeps blank-chat global workspace/preset navigation out of the trace-bound pane', async () => {
    const { host } = fixture(), navigate = vi.fn()
    const entry: StoredEntry = { component: () => null, options: {}, inject: () => ({ selectWorkspace: navigate, nativeComposer: true }) }
    host.entriesOfSlot = () => [entry]
    const pane = createPaneHost(host, source({ sessionId: 'analysis', hooks: {}, props: {} }))
    expect(pane.entriesOfSlot('conversation.hero.workspace')).toEqual([])
    expect(pane.entriesOfSlot('conversation.hero.agentPreset')).toEqual([])
    const injected = pane.entriesOfSlot('conversation')[0]!.inject!() as { selectWorkspace(id: string): Promise<void>; nativeComposer: boolean }
    await injected.selectWorkspace('unrelated')
    expect(navigate).not.toHaveBeenCalled()
    expect(injected.nativeComposer).toBe(true)
    expect(pane.entriesOfSlot('conversation.input.left')).toEqual([entry])
    expect(pane.entriesOfSlot('conversation.input.right')).toEqual([entry])
  })

  it('opens child history independently and reuses the same native renderer tree', async () => {
    const { host } = fixture(), historyOpen = vi.fn(async () => {}), navigate = vi.fn()
    const runtime = {
      list: source({ byId: { analysis: {} }, current: 'parent' }), open: navigate,
      binding: vi.fn(() => ({ session: { open: historyOpen } })),
      maybeProvideInfo: () => ({ sessionId: 'analysis', hooks: {}, props: {} }),
      currentProvideInfo: source({ sessionId: 'parent', hooks: {}, props: {} }),
    }
    const renderRoot = vi.fn(() => 'native tree')
    const bridge = createNativeChatBridge({ hostFace: () => host, _renderer: { renderRoot } }, runtime as unknown as ISessions)
    await bridge.open('analysis', new AbortController().signal)
    expect(historyOpen).toHaveBeenCalledTimes(1)
    expect(bridge.render('analysis')).toBe('native tree')
    expect(bridge.render('analysis')).toBe('native tree')
    expect(renderRoot).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(runtime.list.getSnapshot().current).toBe('parent')
  })

  it('cancels a waiting pane without leaking its subscription or navigating on late arrival', async () => {
    const unsubscribe = vi.fn(), binding = vi.fn(), abort = new AbortController()
    const runtime = { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => unsubscribe }, binding }
    const bridge = createNativeChatBridge({}, runtime as unknown as ISessions)
    const opening = bridge.open('pending', abort.signal)
    abort.abort()
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(binding).not.toHaveBeenCalled()
  })

  it('waits for a restored session to arrive in the native roster before opening its history', async () => {
    let snapshot: { byId: Record<string, object> } = { byId: {} }
    let notify = () => {}
    const unsubscribe = vi.fn(), historyOpen = vi.fn(async () => {}), { host } = fixture()
    const runtime = {
      list: { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { notify = listener; return unsubscribe } },
      binding: () => ({ session: { open: historyOpen } }), maybeProvideInfo: vi.fn(),
    }
    const bridge = createNativeChatBridge({ hostFace: () => host, _renderer: { renderRoot: vi.fn() } }, runtime as unknown as ISessions)
    const opening = bridge.open('restored', new AbortController().signal)
    expect(historyOpen).not.toHaveBeenCalled()
    snapshot = { byId: { restored: {} } }; notify()
    await opening
    expect(historyOpen).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
