import type {
  ConversationNodeDefinition,
  ConversationViewBuilder,
  ConversationViewDefinition,
  ConversationViewNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { RefinementId } from '../types.ts'

/** Hidden mapping from one refinement-created event seq to its sidecar id. */
export type RefinementLinksSnapshot = ReadonlyMap<number, RefinementId>

interface RefinementLinkNode extends ConversationViewNode {
  readonly target: 'refinement-links'
  readonly data: { readonly seq: number; readonly refinementId: RefinementId }
}

interface RefinementLinkState { readonly seq: number; readonly refinementId: RefinementId }

class RefinementLinksBuilder implements ConversationViewBuilder<RefinementLinkNode, RefinementLinksSnapshot> {
  readonly empty: RefinementLinksSnapshot = new Map()
  private readonly links = new Map<number, RefinementId>()

  replace(input: { readonly nodes: readonly RefinementLinkNode[] }): RefinementLinksSnapshot {
    this.links.clear()
    for (const node of input.nodes) this.links.set(node.data.seq, node.data.refinementId)
    return new Map(this.links)
  }

  apply(input: { readonly upserts: readonly RefinementLinkNode[] }): RefinementLinksSnapshot {
    for (const node of input.upserts) this.links.set(node.data.seq, node.data.refinementId)
    return new Map(this.links)
  }
}

/** Hidden event projection; it deliberately contributes no Chat node. */
export const refinementLinkDefinition: ConversationNodeDefinition<RefinementLinkState> = {
  kind: 'refinement-created-link',
  target: 'refinement-links',
  match: event => event.type === 'refinement/created'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'refinement/created') throw new Error('refinement link requires refinement/created')
    return { seq: match.event.seq, refinementId: match.event.data.refinementId }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: context.kind,
    id: context.id,
    target: 'refinement-links',
    data: context.state,
  }),
}

/** Hidden target factory storing the refinement-created sequence links. */
export const refinementLinksViewDefinition: ConversationViewDefinition<RefinementLinkNode, RefinementLinksSnapshot> = {
  target: 'refinement-links',
  create: () => new RefinementLinksBuilder(),
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationViewSnapshotMap {
    /** Log-owned source-event links used by the rich `/refine` command card. */
    'refinement-links': RefinementLinksSnapshot
  }
}
