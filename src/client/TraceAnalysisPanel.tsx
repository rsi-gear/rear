import { useEffect, useSyncExternalStore } from 'react'
import type { RefinementRunView } from '../types.ts'
import { analysisError, type RefinementKey } from './locales.ts'
import { analysisScopeKey, type TraceAnalysisController } from './analysis-controller.ts'
import { DshNativeChatSurface, type NativeChatBridge } from './DshNativeChatSurface.tsx'

export function TraceAnalysisPanel({ controller, nativeChat, refinementId, runs, t, onClose }: {
  readonly controller: TraceAnalysisController
  readonly nativeChat: NativeChatBridge
  readonly refinementId: string
  readonly runs: readonly RefinementRunView[]
  readonly t: (key: RefinementKey) => string
  readonly onClose: () => void
}) {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const scope = { refinementId, runIds: runs.map(run => run.id) }
  const key = analysisScopeKey(scope)
  const state = controller.conversation(scope)
  useEffect(() => { void controller.ensure(scope) }, [controller, key])
  return <section className="rear-analysis" aria-label={t('analysis.title')}>
    <header className="rear-analysis-header">
      <div><strong>{t('analysis.title')}</strong><span className="rear-refinement-muted">{t('analysis.subtitle')}</span></div>
      <button type="button" className="rear-analysis-icon" aria-label={t('analysis.close')} title={t('analysis.close')} onClick={onClose}>
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12 4v12m-5-8 2 2-2 2"/></svg>
      </button>
    </header>
    <div className="rear-analysis-context">
      {state.history.length > 0 && <div className="rear-analysis-history">
        <select aria-label={t('analysis.history')} value={state.session?.sessionId ?? ''} disabled={state.busy || state.loading}
          onChange={event => controller.select(scope, event.target.value)}>
          {state.history.map(chat => <option key={chat.sessionId} value={chat.sessionId}>{chat.title
            .replace(/^(?:Trace chat|轨迹分析) · /u, '').replace(/^(\d+) (?:traces|条轨迹) · /u, `$1 ${t('analysis.scope')} · `)}</option>)}
        </select>
        <button type="button" disabled={state.busy || state.loading} aria-label={t('analysis.new')} title={t('analysis.new')}
          onClick={() => void controller.newChat(scope)}>＋</button>
      </div>}
      <details className="rear-analysis-scope">
        <summary>{runs.length} {t('analysis.scope')}<span>{state.session ? t('analysis.snapshot') : t('analysis.selection')}</span></summary>
        <div>{runs.map((run, index) => <span key={run.id} title={run.id}>{index + 1}. {run.harness.id} · {run.id.slice(-8)}</span>)}</div>
        {state.session && <code>{state.session.directory}</code>}
      </details>
    </div>
    {state.error && <div className="rear-refinement-error" role="alert">{analysisError(state.error, t)}
      <button type="button" onClick={() => void (state.loaded ? controller.newChat(scope) : controller.ensure(scope))}>{t('analysis.retry')}</button>
    </div>}
    {state.busy || state.loading ? <p className="rear-analysis-loading" role="status">{state.busy ? t('analysis.running') : t('analysis.loading')}</p>
      : state.session && <DshNativeChatSurface key={state.session.sessionId} bridge={nativeChat} sessionId={state.session.sessionId}
        t={t} />}
  </section>
}
