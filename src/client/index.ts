/** Browser refinement workbench plugin and its reusable controller. */
import type { Context } from '@deepseek-ai/cordis'
import {
  ConversationNodeAssembler,
  EMPTY_CHAT_SNAPSHOT,
  type ConversationSnapshot,
  type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { RefinementController, type RefinementRemoteClient } from './controller.ts'
import { RefinementView, type RefinementInjected } from './RefinementView.tsx'
import {
  canonicalTrajectoryInputs,
  resolveDshTrajectoryComponent,
  type DshTrajectoryBridge,
} from './DshOfflineTrajectorySurface.tsx'
import type { CanonicalTrajectoryDocument } from '../types.ts'
import { en, zh } from './locales.ts'
import { mountStyles } from './styles.ts'

export { RefinementController } from './controller.ts'
export type { RefinementRemoteClient, RefinementViewState } from './controller.ts'
export { RefinementView } from './RefinementView.tsx'

const NS = 'refinement'

/** Services required by the read-only refinement view and controller directory. */
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
    evaluation: (request, signal) => call('evaluation', request, signal),
    trajectory: (request, signal) => call('trajectory', request, signal),
    providerEvidence: (request, signal) => call('provider-evidence', request, signal),
    interactionEvidence: (request, signal) => call('interaction-evidence', request, signal),
    changes: (request, signal) => call('changes', request, signal),
  }
}

/** Mount the controller directory and read-only Gear experiment view. */
export function apply(ctx: Context): void {
  ctx.effect(mountStyles, 'ui-refinement: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-refinement: dictionaries')
  const remote = remoteAdapter(ctx)
  const controllers = new Map<SessionId, RefinementController>()
  let trajectoryBridge: DshTrajectoryBridge | undefined
  const dshTrajectory = (): DshTrajectoryBridge => {
    trajectoryBridge ??= {
      component: resolveDshTrajectoryComponent(ctx.slots.entries('conversation.view')),
      project: (document: CanonicalTrajectoryDocument): ConversationSnapshot => {
        const assembler = new ConversationNodeAssembler(
          ctx.conversationEvents,
          ctx.conversationViews,
        )
        assembler.replaceWindow(canonicalTrajectoryInputs(document), false)
        assembler.flush()
        if (assembler.snapshot('trajectory') === undefined) {
          throw new Error('DSH trajectory snapshot builder is not registered')
        }
        return {
          sessionId: document.header.id as unknown as SessionId,
          views: assembler,
          chat: EMPTY_CHAT_SNAPSHOT,
          nodes: [],
          turnTimings: new Map(),
          turnEnds: new Map(),
          partial: null,
          runningCalls: [],
          pending: [],
          queue: [],
          running: false,
          subagent: null,
          composerPhase: 'active',
          removed: false,
          openState: 'open',
          openError: null,
          loadingOlder: false,
          hasMore: false,
          promptError: null,
          blank: false,
          lastAgentError: null,
        }
      },
      t: ctx.locale.bind('trajectory') as (key: string) => string,
    }
    return trajectoryBridge
  }
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
      loadProviderEvidence: (runId, fileOrdinal, cursor) => controller.loadProviderEvidence(runId, fileOrdinal, cursor),
      closeProviderEvidence: runId => { controller.closeProviderEvidence(runId) },
      loadInteractionEvidence: (runId, cursor) => controller.loadInteractionEvidence(runId, cursor),
      closeInteractionEvidence: runId => { controller.closeInteractionEvidence(runId) },
      closeDetails: () => { ctx.layout.closeDetails() },
      dshTrajectory: dshTrajectory(),
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
}
