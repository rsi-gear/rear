/** Offline Hitch trajectory rendered by DSH's registered native trajectory view. */

import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import type {
  ConversationEventInput,
  ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { CanonicalTrajectoryDocument } from '../types.ts'

interface NativeTrajectoryViewProps {
  readonly useSession: <Selected>(selector: (snapshot: ConversationSnapshot) => Selected) => Selected
  readonly useDuration: <Selected>(selector: (actualDuration: boolean) => Selected) => Selected
  readonly loadOlder: () => Promise<boolean>
  readonly setActualDuration: (actualDuration: boolean) => void
  readonly t: (key: string) => string
  readonly inspect?: { readonly callId: string } | null
  readonly onInspectDone?: () => void
}

/** Runtime seams already registered by `@deepseek-ai/dsh-client-ui-trajectory`. */
export interface DshTrajectoryBridge {
  readonly component: ComponentType<NativeTrajectoryViewProps>
  readonly project: (document: CanonicalTrajectoryDocument) => ConversationSnapshot
  readonly t: (key: string) => string
}

interface TrajectorySlotEntry {
  readonly component: unknown
  readonly options: { readonly id?: string }
}

/** Resolve the native component from DSH's public conversation-view slot ledger. */
export function resolveDshTrajectoryComponent(
  entries: readonly TrajectorySlotEntry[],
): DshTrajectoryBridge['component'] {
  const entry = entries.find(candidate => candidate.options.id === 'trajectory')
  if (entry === undefined || typeof entry.component !== 'function') {
    throw new Error('REAR requires the registered DSH trajectory conversation view')
  }
  return entry.component as DshTrajectoryBridge['component']
}

/** Preserve every canonical envelope while handing projection ownership to DSH. */
export function canonicalTrajectoryInputs(
  document: CanonicalTrajectoryDocument,
): readonly ConversationEventInput[] {
  return document.events.map(event => ({
    event: event as unknown as ConversationEventInput['event'],
    view: undefined,
  }))
}

export interface DshOfflineTrajectorySurfaceProps {
  readonly bridge: DshTrajectoryBridge
  readonly document: CanonicalTrajectoryDocument
}

/** Render one archived Hitch run through the exact DSH trajectory component. */
export function DshOfflineTrajectorySurface({
  bridge,
  document,
}: DshOfflineTrajectorySurfaceProps) {
  const snapshot = useMemo(
    () => bridge.project(document),
    [bridge, document],
  )
  const [actualDuration, setActualDuration] = useState(false)
  const useSession = <Selected,>(selector: (value: ConversationSnapshot) => Selected): Selected => (
    selector(snapshot)
  )
  const useDuration = <Selected,>(selector: (value: boolean) => Selected): Selected => (
    selector(actualDuration)
  )
  const NativeTrajectoryView = bridge.component
  return (
    <div className="rear-refinement-dsh-trajectory">
      <NativeTrajectoryView
        useSession={useSession}
        useDuration={useDuration}
        loadOlder={async () => false}
        setActualDuration={setActualDuration}
        t={bridge.t}
      />
    </div>
  )
}
