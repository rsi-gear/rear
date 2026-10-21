import { createHash } from 'node:crypto'
import type { CanonicalTrajectoryDocument, RefinementGetRequest } from './types.ts'
import type { RefinementRuntime } from './runtime.ts'
import { traceChatErrors } from './trace-chat-errors.ts'

/** A file-export bound, not a model context window. Evidence is never truncated. */
export const TRACE_EXPORT_MAX_BYTES = 50_000_000
export interface TraceScope { readonly sessionId: string; readonly refinementId: string; readonly runIds: readonly string[] }
export const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`

/** Resolve complete, verified source documents; browser-supplied trace text is never trusted. */
export async function readTraceSnapshot(runtime: RefinementRuntime, request: TraceScope, signal: AbortSignal) {
  signal.throwIfAborted()
  const detail = runtime.get(request as unknown as RefinementGetRequest)
  if (!detail.ok) throw new Error(detail.error.message)
  const traces: { document: CanonicalTrajectoryDocument; content: string; sha256: string }[] = []
  let totalBytes = 0
  for (const runId of [...request.runIds].sort()) {
    let cursor: string | null = null
    let content = ''
    let digest: string | undefined
    do {
      signal.throwIfAborted()
      const page = await runtime.trajectoryPage({ ...request, runId, cursor } as never)
      if (!page.ok) throw new Error(page.error.message)
      if (digest !== undefined && digest !== page.value.sha256) throw new Error(traceChatErrors.changed)
      digest = page.value.sha256
      totalBytes += Buffer.byteLength(page.value.content)
      if (totalBytes > TRACE_EXPORT_MAX_BYTES) throw new Error(traceChatErrors.size)
      content += page.value.content
      cursor = page.value.nextCursor
    } while (cursor !== null)
    const document = JSON.parse(content) as CanonicalTrajectoryDocument
    if (document.runId !== runId || sha256(content) !== digest) throw new Error(traceChatErrors.checksum)
    traces.push({ document, content, sha256: digest })
  }
  signal.throwIfAborted()
  return { experiment: { id: detail.value.id, objective: detail.value.objective, version: detail.value.version }, traces, sourceCwd: detail.value.session.cwd }
}
