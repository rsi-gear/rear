import type { TraceChatRequest, TraceChatSession } from '../trace-chat.ts'

export type AnalysisScope = Pick<TraceChatRequest, 'refinementId' | 'runIds'>
export type CreateTraceChat = (request: AnalysisScope & Pick<TraceChatRequest, 'requestId'>) => Promise<TraceChatSession>
export type ListTraceChats = (scope: AnalysisScope) => Promise<readonly TraceChatSession[]>
export interface AnalysisConversation {
  readonly busy: boolean
  readonly error?: string
  readonly session?: TraceChatSession
  readonly history: readonly TraceChatSession[]
  readonly loading: boolean
  readonly loaded: boolean
}
const EMPTY: AnalysisConversation = { busy: false, history: [], loading: false, loaded: false }
export const analysisScopeKey = (scope: AnalysisScope): string => JSON.stringify([scope.refinementId, [...new Set(scope.runIds)].sort()])

/** Pane selection is local. Messages, tools, cancellation and history belong to DSH Chat. */
export class TraceAnalysisController {
  private state: Readonly<Record<string, AnalysisConversation>> = {}
  private readonly listeners = new Set<() => void>()
  private readonly attempts = new Map<string, string>()
  private disposed = false
  constructor(private readonly createChat: CreateTraceChat, private readonly listChats: ListTraceChats) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  conversation(scope: AnalysisScope): AnalysisConversation { return this.state[analysisScopeKey(scope)] ?? EMPTY }
  private publish(key: string, value: AnalysisConversation) {
    if (this.disposed) return
    this.state = { ...this.state, [key]: value }
    for (const listener of this.listeners) listener()
  }
  async ensure(scope: AnalysisScope): Promise<void> {
    const current = this.conversation(scope), key = analysisScopeKey(scope)
    if (this.disposed || current.loading || current.busy || scope.runIds.length === 0) return
    if (current.loaded) {
      if (!current.session) await this.newChat(scope)
      return
    }
    const { error: _error, ...starting } = current
    this.publish(key, { ...starting, loading: true })
    try {
      const restored = await this.listChats(scope)
      if (this.disposed) return
      const latest = this.conversation(scope)
      const history = [...new Map([...latest.history, ...restored].map(chat => [chat.sessionId, chat])).values()]
      const session = latest.session ?? history[0]
      this.publish(key, { ...latest, history, loading: false, loaded: true, ...(session ? { session } : {}) })
      if (!session) await this.newChat(scope)
    } catch (error) {
      this.publish(key, { ...this.conversation(scope), loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  select(scope: AnalysisScope, sessionId: string): void {
    const current = this.conversation(scope), session = current.history.find(chat => chat.sessionId === sessionId)
    if (current.busy || current.loading) return
    const { error: _error, ...rest } = current
    if (session) this.publish(analysisScopeKey(scope), { ...rest, session })
  }
  async newChat(scope: AnalysisScope): Promise<void> {
    const key = analysisScopeKey(scope), previous = this.conversation(scope)
    if (this.disposed || previous.busy || previous.loading || scope.runIds.length === 0) return
    const requestId = this.attempts.get(key) ?? crypto.randomUUID()
    this.attempts.set(key, requestId)
    const { error: _error, ...starting } = previous
    this.publish(key, { ...starting, busy: true })
    try {
      const session = await this.createChat({ ...scope, runIds: [...scope.runIds].sort(), requestId })
      if (this.disposed) return
      const current = this.conversation(scope)
      this.publish(key, { ...current, busy: false, loaded: true, session,
        history: [session, ...current.history.filter(chat => chat.sessionId !== session.sessionId)] })
      this.attempts.delete(key)
    } catch (error) {
      this.publish(key, { ...this.conversation(scope), busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  dispose(): void { this.disposed = true; this.listeners.clear() }
}
