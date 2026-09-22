import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable, SessionMaybeProvideInfo, SlotRenderer, SlotRendererHost, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { traceChatErrors } from '../trace-chat-errors.ts'
import { analysisError, type RefinementKey } from './locales.ts'

export interface NativeChatBridge {
  open(sessionId: string, signal: AbortSignal): Promise<void>
  render(sessionId: string): ReactNode
}

/** DSH rc.2 has no public multi-pane API. Keep its three assembly seams here;
 * use the installed renderer and real session/input stores, never a second chat loop.
 * No call in this adapter changes the application's selected session.
 */
interface SessionAssembly extends ISessions {
  maybeProvideInfo(id: SessionId | undefined): SessionMaybeProvideInfo
}
interface SlotAssembly {
  readonly _renderer?: SlotRenderer
  hostFace(): SlotRendererHost
}
type NativeRender = (key: string, owner: object) => ReactNode
type Injection = (...args: unknown[]) => Record<string, unknown>

/** Isolated renderer host: child hooks, input, history and tool details share one identity. */
export function createPaneHost(host: SlotRendererHost, provideInfo: HostObservable<SessionMaybeProvideInfo>): SlotRendererHost {
  let showingDetails = false
  let failure: string | null = null
  const listeners = new Set<() => void>()
  const changed = () => { for (const listener of listeners) listener() }
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
  function PaneRoot({ renderSlot }: { renderSlot: NativeRender }) {
    const details = useSyncExternalStore(subscribe, () => showingDetails)
    const error = useSyncExternalStore(subscribe, () => failure)
    return <div className="rear-native-chat-body">
      {error && <p className="rear-native-chat-error" role="alert">{error}</p>}
      {renderSlot('conversation', {})}
      {details && <div className="rear-native-chat-details">{renderSlot('details', {})}</div>}
    </div>
  }
  const root: StoredEntry = { component: PaneRoot, options: {}, children: {
    conversation: { kind: 'single', scope: 'session-maybe' }, details: { kind: 'single', scope: 'session' },
  } }
  const originalByEntry = new Map<StoredEntry, StoredEntry>()
  const decorated = new Map<StoredEntry, StoredEntry>()
  const decorate = (key: string, entry: StoredEntry): StoredEntry => {
    if (key !== 'conversation' && key !== 'conversation.session' && key !== 'details' && !(key === 'conversation.view' && entry.options.id === 'chat')) return entry
    const cached = decorated.get(entry)
    if (cached) return cached
    const replacement: StoredEntry = { ...entry, inject: ((...args: unknown[]) => {
      const injected = (entry.inject as Injection | undefined)?.(...args) ?? {}
      // The full-page blank hero switches the global workspace (and its preset
      // picker targets the global current session). This pane already has a fixed
      // analysis directory; keep those global actions out of the child surface.
      if (key === 'conversation') return { ...injected, selectWorkspace: async () => {} }
      if (key === 'conversation.session') {
        const views = injected.views as { list(): { id: string }[] }
        return { ...injected, views: { ...views, list: () => views.list().filter(view => view.id === 'chat') } }
      }
      if (key === 'details') return { ...injected, closeDetails: () => { showingDetails = false; changed() } }
      const actions = args[1] as { select(target: { callId: string }): void }
      return { ...injected, inspectCall: (callId: string) => {
        actions.select({ callId }); showingDetails = true; changed()
      } }
    }) as StoredEntry['inject'] }
    originalByEntry.set(replacement, entry)
    decorated.set(entry, replacement)
    return replacement
  }
  const entries = (key: string, winners: boolean) => key === 'root' ? [root]
    : key === 'conversation.session.header' || key === 'conversation.hero.workspace' || key === 'conversation.hero.agentPreset' ? []
    : (winners ? host.entriesOfSlot(key) : host.entriesOf(key)).map(entry => decorate(key, entry))
  return {
    ...host,
    sessions: { ...host.sessions, provideInfo },
    entriesOf: key => entries(key, false),
    entriesOfSlot: key => entries(key, true),
    isLive: entry => entry === root || host.isLive(originalByEntry.get(entry) ?? entry),
    storeOf: (entry, scope) => entry === root ? undefined : host.storeOf(originalByEntry.get(entry) ?? entry, scope),
    // A pane error must not retire a shared native entry from the main app.
    reportEntryError: (_key, _entry, error) => { failure = error instanceof Error ? error.message : String(error); changed() },
  }
}

export function createNativeChatBridge(slots: unknown, sessions: ISessions): NativeChatBridge {
  const assembly = slots as SlotAssembly, runtime = sessions as SessionAssembly
  const panes = new Map<string, ReactNode>()
  return {
    async open(value, signal) {
      const id = value as SessionId
      signal.throwIfAborted()
      if (!sessions.list.getSnapshot().byId[id]) await new Promise<void>((resolve, reject) => {
        let unsubscribe = () => {}
        const finish = (error?: Error) => { clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', aborted); error ? reject(error) : resolve() }
        const aborted = () => finish(new DOMException('Pane closed', 'AbortError'))
        const timer = setTimeout(() => finish(new Error(traceChatErrors.missing)), 10_000)
        const changed = () => { if (sessions.list.getSnapshot().byId[id]) finish() }
        unsubscribe = sessions.list.subscribe(changed)
        signal.addEventListener('abort', aborted, { once: true })
        changed()
      })
      signal.throwIfAborted()
      const session = sessions.binding(id)?.session as { open?: () => Promise<void> } | undefined
      if (!session?.open || !assembly._renderer?.renderRoot || typeof runtime.maybeProvideInfo !== 'function' || typeof assembly.hostFace !== 'function') {
        throw new Error(traceChatErrors.unsupported)
      }
      await session.open()
      signal.throwIfAborted()
    },
    render(value) {
      let pane = panes.get(value)
      if (!pane) {
        const provideInfo = {
          getSnapshot: () => runtime.maybeProvideInfo(value as SessionId),
          subscribe: (listener: () => void) => {
            const offList = sessions.list.subscribe(listener), offRoster = sessions.currentProvideInfo.subscribe(listener)
            return () => { offList(); offRoster() }
          },
        }
        pane = assembly._renderer!.renderRoot(createPaneHost(assembly.hostFace(), provideInfo), {})
        panes.set(value, pane)
      }
      return pane
    },
  }
}

class NativeChatBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <p className="rear-native-chat-error" role="alert">{this.state.error}</p> : this.props.children }
}

export function DshNativeChatSurface({ bridge, sessionId, t }: {
  bridge: NativeChatBridge; sessionId: string; t: (key: RefinementKey) => string
}) {
  const [state, setState] = useState<{ ready: boolean; error?: string }>({ ready: false })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    setState({ ready: false })
    bridge.open(sessionId, abort.signal).then(() => { if (!abort.signal.aborted) setState({ ready: true }) }, error => {
      if (!abort.signal.aborted) setState({ ready: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => abort.abort()
  }, [bridge, sessionId, attempt])
  if (state.error) return <div className="rear-native-chat-error" role="alert">{analysisError(state.error, t)}<button type="button" onClick={() => setAttempt(value => value + 1)}>{t('analysis.retry')}</button></div>
  if (!state.ready) return <p className="rear-analysis-loading" role="status">{t('analysis.loading')}</p>
  return <NativeChatBoundary key={sessionId}><div className="rear-native-chat" data-chat-session={sessionId}>{bridge.render(sessionId)}</div></NativeChatBoundary>
}
