import type { CanonicalTrajectoryDocument, CanonicalTrajectoryRecord } from './types.ts'

/** A source-addressed piece of evidence. Types are labels, never pairing constraints. */
export interface TraceBlock {
  readonly id: string
  readonly runId: string
  readonly seq: number
  readonly path: string
  readonly kind: string
  readonly text: string
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

function rendered(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
}

/** Keep exact strings and JSON fallbacks, including unfamiliar event types. */
export function traceBlocks(document: CanonicalTrajectoryDocument): readonly TraceBlock[] {
  return document.records.flatMap((record: CanonicalTrajectoryRecord) => {
    const seq = 'seq' in record ? record.seq : record.seq0
    const data = object(record.data) ?? {}
    const result: TraceBlock[] = []
    const add = (path: string, kind: string, value: unknown): void => {
      if (value === undefined) return
      result.push({ id: `${document.runId}:${seq}:${path}`, runId: document.runId, seq, path, kind, text: rendered(value) })
    }
    if (record.type === 'request/header') {
      const header = object(data.header) ?? data
      add('header.system', 'system prompt', header.system)
      add('header.tools', 'tool schemas', header.tools)
      add('header.config', 'model config', header.config)
    }
    const message = object(data.message)
    const content = message?.content ?? data.content
    if (Array.isArray(content)) content.forEach((part: unknown, index) => {
      const block = object(part)
      add(`${message === undefined ? '' : 'message.'}content[${index}]`, `${record.type} / ${String(block?.type ?? 'content')}`, block?.text ?? part)
    })
    if (record.type === 'tool/call') add('arguments', `tool input · ${String(data.name ?? '')}`, data.arguments)
    if (record.type === 'tool/result') add('result', 'tool output', data.result)
    // Every event remains selectable even when it has no recognized text block.
    add('$', record.type, record.data)
    return result
  })
}

export interface PinnedTraceBlock extends TraceBlock {
  readonly selectionId: string
  readonly start: number
  readonly end: number
}

/** Character offsets refer to the exact displayed source, not an edited copy. */
export function pinTraceBlock(block: TraceBlock, start = 0, end = block.text.length): PinnedTraceBlock {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > block.text.length) {
    throw new RangeError('Invalid source selection')
  }
  return { ...block, selectionId: `${block.id}:${start}:${end}`, start, end, text: block.text.slice(start, end) }
}

/** Textareas normalize CRLF/CR to LF; convert their UTF-16 offsets back to the source. */
export function pinTraceSelection(block: TraceBlock, start: number, end: number): PinnedTraceBlock {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new RangeError('Invalid source selection')
  }
  let source = 0, displayed = 0, sourceStart = 0
  while (displayed < end && source < block.text.length) {
    if (displayed === start) sourceStart = source
    source += block.text[source] === '\r' && block.text[source + 1] === '\n' ? 2 : 1
    displayed++
  }
  if (displayed !== end) throw new RangeError('Invalid source selection')
  return pinTraceBlock(block, start === end ? source : sourceStart, source)
}
