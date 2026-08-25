/** Browser refinement workbench plugin and its reusable controller. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { RefinementController, type RefinementRemoteClient } from './controller.ts'
import { RefineCommandCard, RefinementView, type RefinementInjected } from './RefinementView.tsx'
import { refinementLinkDefinition, refinementLinksViewDefinition } from './refinement-links.ts'
import { en, zh } from './locales.ts'
import { mountStyles } from './styles.ts'

export { RefinementController } from './controller.ts'
export type { RefinementRemoteClient, RefinementViewState } from './controller.ts'
export { RefineCommandCard, RefinementView } from './RefinementView.tsx'

const NS = 'refinement'

/** Services required by the refinement view, rich command card, and controller directory. */
export const inject = [
  'slots', 'sessions', 'connection', 'locale', 'layout',
  'conversationEvents', 'conversationViews',
]

function abortError(): Error {
  return new DOMException('refinement request aborted', 'AbortError')
}

function remoteAdapter(ctx: Context): RefinementRemoteClient {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const call = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
    const aborted = (): boolean => signal?.aborted ?? false
    if (aborted()) throw abortError()
    const transport = await connection.rpc.call('/refinement', endpoint, payload, signal)
    if (aborted()) throw abortError()
    if (!transport.ok) throw new Error(`${transport.error.message} (${transport.error.code})`)
    return transport.value as T
  }
  return {
    list: (request, signal) => call('list', request, signal),
    get: (request, signal) => call('get', request, signal),
    cancel: (request, signal) => call('cancel', request, signal),
    evaluation: (request, signal) => call('evaluation', request, signal),
    trajectory: (request, signal) => call('trajectory', request, signal),
    providerEvidence: (request, signal) => call('provider-evidence', request, signal),
    changes: (request, signal) => call('changes', request, signal),
  }
}

/** Mount the hidden link projection, controller directory, view, and rich command renderer. */
export function apply(ctx: Context): void {
  ctx.effect(mountStyles, 'ui-refinement: styles')
  ctx.conversationEvents.register(refinementLinkDefinition)
  ctx.conversationViews.register(refinementLinksViewDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-refinement: dictionaries')
  const remote = remoteAdapter(ctx)
  const controllers = new Map<SessionId, RefinementController>()
  const controllerFor = (sessionId: SessionId): RefinementController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new RefinementController(remote, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }
  const injectFor = (sessionId: SessionId): RefinementInjected => {
    const controller = controllerFor(sessionId)
    return {
      hooks: { refinement: controller },
      ensure: () => controller.ensure(),
      selectRefinement: refinementId => controller.selectRefinement(refinementId),
      selectIteration: iterationId => controller.selectIteration(iterationId),
      setComparisonDimension: dimension => controller.setComparisonDimension(dimension),
      openTask: taskKey => controller.openTask(taskKey),
      selectRuns: runIds => controller.selectRuns(runIds),
      back: () => { controller.back() },
      cancel: () => controller.cancel(),
      loadProviderEvidence: (runId, fileOrdinal, cursor) => controller.loadProviderEvidence(runId, fileOrdinal, cursor),
      closeProviderEvidence: runId => { controller.closeProviderEvidence(runId) },
      closeDetails: () => { ctx.layout.closeDetails() },
    }
  }

  ctx.effect(
    () => ctx.on('connection/reset', () => {
      for (const controller of controllers.values()) controller.reconnect()
    }),
    'ui-refinement: reconnect resync',
  )
  ctx.effect(() => () => {
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
  }, 'ui-refinement: controller directory')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'refinement',
    order: 20,
    locale: NS,
    label: () => t('view.refinement'),
    inject: (sessionId: SessionId): RefinementInjected => injectFor(sessionId),
  }, RefinementView))
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'refine',
    locale: NS,
    inject: (sessionId: SessionId): RefinementInjected => injectFor(sessionId),
  }, RefineCommandCard))
}
