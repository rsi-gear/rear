import { useMemo, useState } from 'react'
import type {
  CanonicalTrajectoryDocument,
  CanonicalTrajectoryEvent,
  RefinementJsonValue,
} from '../types.ts'
import type { RefinementKey } from './locales.ts'

type JsonObject = { readonly [key: string]: RefinementJsonValue }

export type OfflineTrajectoryKind =
  | 'system'
  | 'user'
  | 'context'
  | 'assistant'
  | 'tool-call'
  | 'tool-result'
  | 'lifecycle'
  | 'event'

interface PromptSnapshot {
  readonly system: string
  readonly tools: readonly RefinementJsonValue[]
  readonly config: JsonObject | null
}

interface AssistantTiming {
  readonly stepStartTime: number | null
  readonly firstTokenTime: number | null
  readonly completedTime: number | null
}

/** Presentation row derived from one canonical Session lifecycle. */
export interface OfflineTrajectoryRow {
  readonly key: string
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly elapsedMs: number
  readonly turn: number | null
  readonly step: number | null
  readonly kind: OfflineTrajectoryKind
  readonly subject: string | null
  readonly callId: string | null
  readonly summary: string
  readonly detail: string
  readonly source?: RefinementJsonValue
  readonly inputDetail?: string
  readonly outputDetail?: string
  readonly thinkingDetail?: string
  readonly promptDetail?: PromptSnapshot
  readonly previousPromptDetail?: PromptSnapshot
  readonly schemaDetail?: string
  readonly usage?: JsonObject
  readonly timing?: AssistantTiming
  readonly startedAt?: number | null
  readonly completedAt?: number | null
  readonly isError?: boolean
}

function object(value: RefinementJsonValue | undefined): JsonObject | null {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === 'object'
    ? value
    : null
}

function number(value: RefinementJsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function string(value: RefinementJsonValue | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function json(value: unknown, pretty = false): string {
  const rendered = JSON.stringify(value, null, pretty ? 2 : undefined)
  return rendered === undefined ? '' : rendered
}

function text(value: RefinementJsonValue | undefined): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean).join('\n')
  const valueObject = object(value)
  const direct = string(valueObject?.text)
  if (direct !== null) return direct
  if (valueObject?.content !== undefined) return text(valueObject.content)
  return json(value)
}

function blocks(value: RefinementJsonValue | undefined): readonly JsonObject[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    const block = object(item)
    return block === null ? [] : [block]
  })
}

function blockText(value: RefinementJsonValue | undefined, type: string): string {
  return blocks(value)
    .filter(block => block.type === type)
    .map(block => text(block.text ?? block.content))
    .filter(Boolean)
    .join('\n\n')
}

function assistantParts(value: RefinementJsonValue | undefined): {
  output: string
  thinking: string
  summary: string
} {
  const output = blockText(value, 'text')
  const thinking = blockText(value, 'reasoning')
  const toolCalls = blocks(value).filter(block => block.type === 'tool-call').length
  return {
    output,
    thinking,
    // DSH uses final text when it exists and falls back to reasoning for a
    // tool-call-only assistant. It does not concatenate both into one row.
    summary: output || thinking || (toolCalls > 0 ? 'Tool call only' : ''),
  }
}

function locationKey(turn: number | null, step: number | null): string | null {
  return turn === null || step === null ? null : `${turn}:${step}`
}

function eventLocation(event: CanonicalTrajectoryEvent): { turn: number | null; step: number | null } {
  const data = object(event.data)
  return { turn: number(data?.turn), step: number(data?.step) }
}

function isTokenChunk(event: CanonicalTrajectoryEvent): boolean {
  if (event.type !== 'assistant/chunk') return false
  const type = string(object(object(event.data)?.chunk)?.type)
  return type === 'text-delta' || type === 'reasoning-delta' || type === 'tool-call-delta'
}

function streamedAssistantText(events: readonly CanonicalTrajectoryEvent[]): string {
  const byBlock = new Map<number, string>()
  for (const event of events) {
    const chunk = object(object(event.data)?.chunk)
    const type = string(chunk?.type)
    if (type !== 'text-delta' && type !== 'reasoning-delta') continue
    const value = string(chunk?.text)
    if (value === null) continue
    const index = number(chunk?.index) ?? 0
    byBlock.set(index, `${byBlock.get(index) ?? ''}${value}`)
  }
  return [...byBlock.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value)
    .filter(Boolean)
    .join('\n\n')
}

function samePrompt(left: PromptSnapshot, right: PromptSnapshot): boolean {
  return left.system === right.system && json(left.tools) === json(right.tools)
}

function promptSnapshot(event: CanonicalTrajectoryEvent): PromptSnapshot | null {
  const header = object(object(event.data)?.header)
  if (header === null) return null
  return {
    system: typeof header.system === 'string' ? header.system : '',
    tools: Array.isArray(header.tools) ? header.tools : [],
    config: object(header.config),
  }
}

function sourceOf(event: CanonicalTrajectoryEvent): RefinementJsonValue | undefined {
  const data = object(event.data)
  if (event.type === 'assistant/message' || event.type === 'tool/result') {
    return object(data?.message)?.source
  }
  return data?.source
}

function toolResult(event: CanonicalTrajectoryEvent): {
  callId: string | null
  output: string
  summary: string
  isError: boolean
} {
  const data = object(event.data)
  const message = object(data?.message)
  const source = object(message?.source)
  const resultBlock = blocks(message?.content).find(block => block.type === 'tool-result')
  const output = text(resultBlock?.content ?? data?.result ?? data?.output)
  const isError = resultBlock?.isError === true || data?.error !== undefined
  const error = object(data?.error)
  return {
    callId: string(data?.callId) ?? string(source?.callId) ?? string(resultBlock?.toolCallId),
    output,
    summary: isError ? string(error?.code) ?? 'error' : output || 'No output',
    isError,
  }
}

function toolSchemasAt(events: readonly CanonicalTrajectoryEvent[]): ReadonlyMap<number, ReadonlyMap<string, RefinementJsonValue>> {
  const result = new Map<number, ReadonlyMap<string, RefinementJsonValue>>()
  let current = new Map<string, RefinementJsonValue>()
  for (const event of events) {
    if (event.type === 'request/header') {
      const prompt = promptSnapshot(event)
      if (prompt !== null) {
        current = new Map(prompt.tools.flatMap(tool => {
          const name = string(object(tool)?.name)
          return name === null ? [] : [[name, tool] as const]
        }))
      }
    }
    result.set(event.seq, current)
  }
  return result
}

interface ProjectedRow extends Omit<OfflineTrajectoryRow, 'elapsedMs'> {}

/**
 * Convert persisted events using the same high-level lifecycle rules as DSH:
 * lifecycle/chunk/ignorable events stay in raw evidence, initial prompt state
 * becomes the first SYSTEM record, messages retain their roles, and Tool call
 * plus result are left pairable by one stable call id.
 */
export function buildOfflineTrajectoryRows(document: CanonicalTrajectoryDocument): readonly OfflineTrajectoryRow[] {
  const stepStarts = new Map<string, number>()
  const chunksByLocation = new Map<string, CanonicalTrajectoryEvent[]>()
  const finalizedLocations = new Set<string>()
  const schemasAt = toolSchemasAt(document.events)
  let openTurn: number | null = null
  let openStep: number | null = null
  const locations = new Map<number, { turn: number | null; step: number | null }>()

  for (const event of document.events) {
    const direct = eventLocation(event)
    if (event.type === 'turn/start') openTurn = direct.turn
    if (event.type === 'step/start') {
      openTurn = direct.turn ?? openTurn
      openStep = direct.step
      const key = locationKey(openTurn, openStep)
      if (key !== null) stepStarts.set(key, event.time)
    }
    const turn = direct.turn ?? openTurn
    const step = direct.step ?? openStep
    locations.set(event.seq, { turn, step })
    const key = locationKey(turn, step)
    if (event.type === 'assistant/chunk' && key !== null) {
      const chunks = chunksByLocation.get(key) ?? []
      chunks.push(event)
      chunksByLocation.set(key, chunks)
    }
    if (event.type === 'assistant/message' && key !== null) finalizedLocations.add(key)
    if (event.type === 'step/end') openStep = null
    if (event.type === 'turn/end') {
      openStep = null
      openTurn = null
    }
  }

  const firstAssistantTurn = document.events.flatMap(event => {
    if (event.type !== 'assistant/message') return []
    const turn = locations.get(event.seq)?.turn
    return turn === null || turn === undefined ? [] : [turn]
  }).at(0) ?? 1
  const projected: ProjectedRow[] = []
  const initialSystems: ProjectedRow[] = []
  let previousPrompt: PromptSnapshot | undefined

  for (const event of document.events) {
    const data = object(event.data)
    const located = locations.get(event.seq) ?? eventLocation(event)
    const turn = located.turn
    const step = located.step
    const key = locationKey(turn, step)

    if (event.type === 'request/header') {
      const prompt = promptSnapshot(event)
      if (prompt === null) continue
      const reason = string(data?.reason)
      const initial = previousPrompt === undefined && reason === 'initial'
      const changed = previousPrompt !== undefined && !samePrompt(previousPrompt, prompt)
      if (initial || changed) {
        const row: ProjectedRow = {
          key: `${event.seq}:request/system`, type: 'request/header', seq: event.seq,
          time: event.time, turn: turn ?? firstAssistantTurn, step,
          kind: 'system', subject: null, callId: null,
          summary: initial
            ? 'Initial System Prompt'
            : previousPrompt?.system === prompt.system
              ? 'Tools Updated'
              : json(previousPrompt?.tools) === json(prompt.tools)
                ? 'System Prompt Updated'
                : 'System Prompt and Tools Updated',
          detail: prompt.system,
          promptDetail: prompt,
          ...(previousPrompt === undefined ? {} : { previousPromptDetail: previousPrompt }),
          startedAt: event.time,
          completedAt: event.time,
        }
        if (initial) initialSystems.push(row)
        else projected.push(row)
      }
      previousPrompt = prompt
      continue
    }

    // These records drive lifecycle, request projection, or streaming state;
    // DSH does not render them as standalone EVENT rows.
    if (
      event.type === 'turn/start' || event.type === 'turn/end'
      || event.type === 'step/start' || event.type === 'step/end'
      || event.type === 'session/end' || event.type === 'assistant/chunk'
    ) continue
    if (event.ignorable === true) continue

    if (event.type === 'user/message') {
      const source = sourceOf(event)
      const role = string(object(source)?.kind) === 'user' ? 'user' : 'context'
      const input = text(data?.content)
      projected.push({
        key: `${event.seq}:${event.type}`, type: event.type, seq: event.seq,
        time: event.time, turn: turn ?? firstAssistantTurn, step,
        kind: role, subject: null, callId: null, summary: input,
        detail: input, inputDetail: input,
        ...(source === undefined ? {} : { source }),
        startedAt: event.time, completedAt: event.time,
      })
      continue
    }

    if (event.type === 'assistant/message') {
      const message = object(data?.message)
      const content = message?.content ?? data?.content
      const parts = assistantParts(content)
      const chunks = key === null ? [] : chunksByLocation.get(key) ?? []
      const usage = object(data?.usage)
      projected.push({
        key: `${event.seq}:${event.type}`, type: event.type, seq: event.seq,
        time: event.time, turn, step, kind: 'assistant', subject: null,
        callId: null, summary: parts.summary,
        detail: [parts.thinking, parts.output].filter(Boolean).join('\n\n'),
        ...(parts.output === '' ? {} : { outputDetail: parts.output }),
        ...(parts.thinking === '' ? {} : { thinkingDetail: parts.thinking }),
        ...(usage === null ? {} : { usage }),
        timing: {
          stepStartTime: key === null ? null : stepStarts.get(key) ?? null,
          firstTokenTime: chunks.find(isTokenChunk)?.time ?? null,
          completedTime: event.time,
        },
        startedAt: key === null ? null : stepStarts.get(key) ?? null,
        completedAt: event.time,
      })
      continue
    }

    if (event.type === 'tool/call') {
      const callId = string(data?.callId) ?? string(data?.id)
      const name = string(data?.name) ?? string(data?.tool) ?? callId
      const input = text(data?.arguments ?? data?.input)
      const schema = name === null ? undefined : schemasAt.get(event.seq)?.get(name)
      projected.push({
        key: `${event.seq}:${event.type}`, type: event.type, seq: event.seq,
        time: event.time, turn, step, kind: 'tool-call', subject: name,
        callId, summary: input, detail: input, inputDetail: input,
        ...(schema === undefined ? {} : { schemaDetail: json(schema, true) }),
        startedAt: event.time,
      })
      continue
    }

    if (event.type === 'tool/result') {
      const result = toolResult(event)
      projected.push({
        key: `${event.seq}:${event.type}`, type: event.type, seq: event.seq,
        time: event.time, turn, step, kind: 'tool-result', subject: null,
        callId: result.callId, summary: result.summary,
        detail: result.output, outputDetail: result.output,
        isError: result.isError, completedAt: event.time,
      })
      continue
    }

    projected.push({
      key: `${event.seq}:${event.type}`, type: event.type, seq: event.seq,
      time: event.time, turn, step, kind: 'event', subject: event.type,
      callId: null, summary: text(event.data), detail: json(event, true),
      startedAt: event.time, completedAt: event.time,
    })
  }

  // A finalized session should not need this path, but preserving one compact
  // partial assistant matches DSH's interrupted-session behavior.
  for (const [key, events] of chunksByLocation) {
    if (finalizedLocations.has(key)) continue
    const summary = streamedAssistantText(events)
    if (summary === '') continue
    const first = events[0] as CanonicalTrajectoryEvent
    const last = events.at(-1) as CanonicalTrajectoryEvent
    const location = locations.get(first.seq) ?? { turn: null, step: null }
    projected.push({
      key: `${first.seq}:assistant/stream`, type: 'assistant/stream', seq: first.seq,
      time: first.time, turn: location.turn, step: location.step,
      kind: 'assistant', subject: null, callId: null, summary, detail: summary,
      outputDetail: summary,
      timing: {
        stepStartTime: stepStarts.get(key) ?? null,
        firstTokenTime: events.find(isTokenChunk)?.time ?? null,
        completedTime: null,
      },
      startedAt: stepStarts.get(key) ?? null,
      completedAt: last.time,
    })
  }

  const ordered = [...initialSystems, ...projected.sort((left, right) => left.seq - right.seq)]
  const origin = Math.min(...ordered.map(row => row.time), document.header.createdAt)
  return ordered.map(row => ({ ...row, elapsedMs: Math.max(0, row.time - origin) }))
}

export interface OfflineTrajectoryRecord {
  readonly row: OfflineTrajectoryRow
  readonly result: OfflineTrajectoryRow | null
  readonly collapsedSummary?: string
}

function ledgerRecords(rows: readonly OfflineTrajectoryRow[]): readonly OfflineTrajectoryRecord[] {
  const results = new Map(rows.flatMap(row => row.kind === 'tool-result' && row.callId !== null
    ? [[row.callId, row] as const]
    : []))
  const pairedResults = new Set<OfflineTrajectoryRow>()
  const records = rows.flatMap(row => {
    if (row.kind === 'lifecycle') return []
    if (row.kind !== 'tool-call' || row.callId === null) return [{ row, result: null }]
    const result = results.get(row.callId) ?? null
    if (result !== null) pairedResults.add(result)
    return [{ row, result }]
  })
  return records.filter(record => record.row.kind !== 'tool-result' || !pairedResults.has(record.row))
}

/** Public lifecycle projection used by parity tests and the offline surface. */
export function buildOfflineTrajectoryRecords(document: CanonicalTrajectoryDocument): readonly OfflineTrajectoryRecord[] {
  return ledgerRecords(buildOfflineTrajectoryRows(document))
}

type LedgerRecord = OfflineTrajectoryRecord
type RecordKind = 'system' | 'user' | 'context' | 'assistant' | 'tool' | 'event'

function recordKind(record: LedgerRecord): RecordKind {
  if (record.row.kind === 'system') return 'system'
  if (record.row.kind === 'user') return 'user'
  if (record.row.kind === 'context') return 'context'
  if (record.row.kind === 'assistant') return 'assistant'
  if (record.row.kind === 'tool-call' || record.row.kind === 'tool-result') return 'tool'
  return 'event'
}

function kindLabel(record: LedgerRecord): string {
  const kind = recordKind(record)
  if (kind === 'assistant') return 'ASSISTANT'
  return kind.toLocaleUpperCase()
}

function recordSearchText(record: LedgerRecord): string {
  return [record.row.type, record.row.subject, record.row.summary, record.row.detail,
    record.row.inputDetail, record.row.outputDetail, record.row.thinkingDetail,
    record.result?.summary, record.result?.detail].filter(Boolean).join('\n').toLocaleLowerCase()
}

function recordSummary(record: LedgerRecord): string {
  if (record.collapsedSummary !== undefined) return record.collapsedSummary
  if (recordKind(record) !== 'tool') return record.row.summary || record.row.type
  const request = [record.row.subject, record.row.summary].filter(Boolean).join(' ')
  return record.result === null || record.result.summary === ''
    ? request
    : `${request}  →  ${record.result.summary}`
}

function collapseCallRecords(records: readonly LedgerRecord[]): LedgerRecord[] {
  const visible: LedgerRecord[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] as LedgerRecord
    visible.push(record)
    if (recordKind(record) !== 'assistant') continue
    const calls: LedgerRecord[] = []
    while (records[index + 1] !== undefined && recordKind(records[index + 1] as LedgerRecord) === 'tool') {
      calls.push(records[++index] as LedgerRecord)
    }
    if (calls.length === 0) continue
    const names = [...new Set(calls.map(call => call.row.subject).filter((name): name is string => name !== null))]
    visible.push({
      row: { ...record.row, key: `${record.row.key}:collapsed-calls` },
      result: null,
      collapsedSummary: `${calls.length} tool ${calls.length === 1 ? 'call' : 'calls'}${names.length === 0 ? '' : ` · ${names.join(', ')}`}`,
    })
  }
  return visible
}

function collapseTurnRecords(records: readonly LedgerRecord[]): LedgerRecord[] {
  const byTurn = new Map<number, LedgerRecord[]>()
  for (const record of records) {
    if (record.row.turn === null || recordKind(record) === 'system') continue
    const turn = byTurn.get(record.row.turn) ?? []
    turn.push(record)
    byTurn.set(record.row.turn, turn)
  }
  const emitted = new Set<number>()
  return records.flatMap(record => {
    const turn = record.row.turn
    if (turn === null || recordKind(record) === 'system') return [record]
    if (emitted.has(turn)) return []
    emitted.add(turn)
    const turnRecords = byTurn.get(turn) ?? [record]
    if (turnRecords.length <= 1) return [record]
    const toolCalls = turnRecords.filter(item => recordKind(item) === 'tool').length
    const steps = new Set(turnRecords.map(item => item.row.step).filter(step => step !== null)).size
    return [record, {
      row: { ...record.row, key: `${record.row.key}:collapsed-turn` },
      result: null,
      collapsedSummary: `${steps} ${steps === 1 ? 'step' : 'steps'} · ${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'}`,
    }]
  })
}

function displayRecords(
  records: readonly LedgerRecord[],
  searchQuery: string,
  collapsedTurns: boolean,
  collapsedCalls: boolean,
): readonly LedgerRecord[] {
  const terms = searchQuery.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  let visible = terms.length === 0
    ? [...records]
    : records.filter(record => terms.every(term => recordSearchText(record).includes(term)))
  if (collapsedCalls) visible = collapseCallRecords(visible)
  if (collapsedTurns) visible = collapseTurnRecords(visible)
  return visible
}

type DetailTab = 'overview' | 'rendered' | 'raw' | 'source' | 'input' | 'output' | 'schema' | 'timing' | 'system-prompt' | 'tools' | 'diff'
interface DetailTabItem { readonly id: DetailTab; readonly label: string }

function detailTabs(record: LedgerRecord): readonly DetailTabItem[] {
  const kind = recordKind(record)
  if (kind === 'system') {
    return [
      ...(record.row.previousPromptDetail === undefined ? [] : [{ id: 'diff', label: 'Diff' } as const]),
      { id: 'system-prompt', label: 'System Prompt' },
      { id: 'tools', label: 'Tools' },
    ]
  }
  if (kind === 'tool') {
    return [
      { id: 'overview', label: 'Summary' },
      ...(record.row.inputDetail ? [{ id: 'input', label: 'Payload' } as const] : []),
      ...(record.result?.outputDetail ? [{ id: 'output', label: 'Result' } as const] : []),
      { id: 'schema', label: 'Schema' },
      { id: 'timing', label: 'Timing' },
    ]
  }
  if (kind === 'event') return [{ id: 'overview', label: 'Summary' }, { id: 'raw', label: 'Raw' }]
  return [
    { id: 'overview', label: 'Summary' },
    { id: 'rendered', label: 'Preview' },
    { id: 'raw', label: 'Raw' },
    ...(record.row.source === undefined ? [] : [{ id: 'source', label: 'Source' } as const]),
  ]
}

function firstDetailTab(record: LedgerRecord): DetailTab {
  return recordKind(record) === 'system' ? 'system-prompt' : 'overview'
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return 'Not recorded'
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`
}

function toolDuration(record: LedgerRecord): number | null {
  if (record.result === null) return null
  return Math.max(0, record.result.time - record.row.time)
}

function DetailPanel({ record, activeTab }: { readonly record: LedgerRecord; readonly activeTab: DetailTab }) {
  const kind = recordKind(record)
  if (activeTab === 'system-prompt') {
    return <pre>{record.row.promptDetail?.system || 'No system prompt in this request'}</pre>
  }
  if (activeTab === 'tools') {
    const tools = record.row.promptDetail?.tools ?? []
    return <pre>{tools.length === 0 ? 'No tools in this request' : json(tools, true)}</pre>
  }
  if (activeTab === 'diff') {
    return <pre>{json({ before: record.row.previousPromptDetail, after: record.row.promptDetail }, true)}</pre>
  }
  if (activeTab === 'source') return <pre>{json(record.row.source, true)}</pre>
  if (activeTab === 'input') return <pre>{record.row.inputDetail || 'No payload captured'}</pre>
  if (activeTab === 'output') return <pre data-error={record.result?.isError === true}>{record.result?.outputDetail || 'No result captured'}</pre>
  if (activeTab === 'schema') return <pre>{record.row.schemaDetail || 'Schema unavailable'}</pre>
  if (activeTab === 'timing') {
    const duration = kind === 'tool' ? toolDuration(record) : null
    return (
      <dl className="rear-refinement-native-details-meta">
        <div><dt>Started</dt><dd>{new Date(record.row.startedAt ?? record.row.time).toLocaleString()}</dd></div>
        <div><dt>Duration</dt><dd>{formatDuration(duration)}</dd></div>
        <div><dt>Timing source</dt><dd>{duration === null ? 'Not available' : 'Session timestamps'}</dd></div>
      </dl>
    )
  }
  if (activeTab === 'rendered') {
    return (
      <div className="rear-refinement-native-details-document">
        {record.row.thinkingDetail && <details><summary>Thinking</summary><pre>{record.row.thinkingDetail}</pre></details>}
        <pre>{(record.row.outputDetail ?? record.row.inputDetail ?? record.row.detail) || 'No content'}</pre>
      </div>
    )
  }
  if (activeTab === 'raw') return <pre>{record.row.detail || 'No content'}</pre>
  const usage = record.row.usage
  const timing = record.row.timing
  return (
    <div className="rear-refinement-native-details-summary">
      <dl className="rear-refinement-native-details-meta">
        <div><dt>Status</dt><dd data-error={record.row.isError === true || record.result?.isError === true}>{record.row.isError === true || record.result?.isError === true ? 'Failed' : record.result === null && kind === 'tool' ? 'Pending' : 'Completed'}</dd></div>
        {record.row.source !== undefined && <div><dt>Source</dt><dd>{string(object(record.row.source)?.kind) ?? 'Unknown'}</dd></div>}
        {record.row.callId !== null && <div><dt>Call ID</dt><dd>{record.row.callId}</dd></div>}
        {usage !== undefined && <div><dt>Tokens</dt><dd>{number(usage.outputTokens) ?? '—'}</dd></div>}
        {timing !== undefined && <div><dt>TTFT</dt><dd>{formatDuration(timing.stepStartTime === null || timing.firstTokenTime === null ? null : Math.max(0, timing.firstTokenTime - timing.stepStartTime))}</dd></div>}
        {kind === 'tool' && <div><dt>Duration</dt><dd>{formatDuration(toolDuration(record))}</dd></div>}
      </dl>
      <div className="rear-refinement-native-details-preview">
        {kind === 'tool'
          ? <><strong>Payload</strong><pre>{record.row.inputDetail || 'No payload captured'}</pre><strong>Result</strong><pre data-error={record.result?.isError === true}>{record.result?.outputDetail || 'No result captured'}</pre></>
          : <pre>{(record.row.outputDetail ?? record.row.inputDetail ?? record.row.summary) || 'No content'}</pre>}
      </div>
    </div>
  )
}

export interface OfflineTrajectorySurfaceProps {
  readonly document: CanonicalTrajectoryDocument
  readonly t: (key: RefinementKey) => string
}

function TrajectoryOverview({ records, actualDuration, selectedKey, onSelect, t }: {
  readonly records: readonly LedgerRecord[]
  readonly actualDuration: boolean
  readonly selectedKey: string | null
  readonly onSelect: (key: string) => void
  readonly t: OfflineTrajectorySurfaceProps['t']
}) {
  const total = Math.max(1, ...records.map(record => record.row.elapsedMs))
  return (
    <div className="rear-refinement-native-timeline" role="region" aria-label={t('trajectory.timeline')}>
      <div className="rear-refinement-native-timeline-labels" aria-hidden="true">
        <span>{t('trajectory.input')}</span><span>{t('trajectory.model')}</span><span>{t('trajectory.tools')}</span>
      </div>
      <div className="rear-refinement-native-timeline-track">
        {records.map((record, index) => {
          const next = records[index + 1]
          const left = actualDuration ? (record.row.elapsedMs / total) * 100 : (index / Math.max(1, records.length)) * 100
          const width = actualDuration
            ? Math.max(1.5, (((next?.row.elapsedMs ?? total) - record.row.elapsedMs) / total) * 100)
            : Math.max(1.5, 100 / Math.max(1, records.length))
          return (
            <button
              type="button"
              key={record.row.key}
              className="rear-refinement-native-timeline-span"
              data-kind={recordKind(record)}
              data-error={record.row.isError === true || record.result?.isError === true}
              data-selected={selectedKey === record.row.key}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              title={`${kindLabel(record)} · ${recordSummary(record)}`}
              onClick={() => { onSelect(record.row.key) }}
            />
          )
        })}
      </div>
    </div>
  )
}

/** DSH-native-shaped ledger backed by persisted, offline run evidence. */
export function OfflineTrajectorySurface({ document, t }: OfflineTrajectorySurfaceProps) {
  const rows = useMemo(() => buildOfflineTrajectoryRows(document), [document])
  const records = useMemo(() => ledgerRecords(rows), [rows])
  const [actualDuration, setActualDuration] = useState(false)
  const [collapsedTurns, setCollapsedTurns] = useState(false)
  const [collapsedCalls, setCollapsedCalls] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')
  const visibleRecords = useMemo(
    () => displayRecords(records, searchQuery, collapsedTurns, collapsedCalls),
    [collapsedCalls, collapsedTurns, records, searchQuery],
  )
  const selected = records.find(record => record.row.key === selectedKey) ?? null
  const select = (key: string) => {
    const record = records.find(candidate => candidate.row.key === key)
    setSelectedKey(key)
    if (record !== undefined) setActiveTab(firstDetailTab(record))
  }
  const tabs = selected === null ? [] : detailTabs(selected)
  return (
    <div className="rear-refinement-native-trajectory">
      <div className="rear-refinement-native-toolbar" role="toolbar" aria-label={t('trajectory.toolbar')}>
        <div className="rear-refinement-native-actions">
          <button type="button" aria-pressed={actualDuration} title={t('trajectory.durationHint')} onClick={() => { setActualDuration(value => !value) }}>
            <span aria-hidden="true">◷</span> {t('trajectory.toolbarDuration')}
          </button>
          <button type="button" aria-pressed={collapsedTurns} title={t('trajectory.turnsHint')} onClick={() => { setCollapsedTurns(value => !value) }}>
            <span aria-hidden="true">⊟</span> {t('trajectory.toolbarTurns')}
          </button>
          <button type="button" aria-pressed={collapsedCalls} title={t('trajectory.callsHint')} onClick={() => { setCollapsedCalls(value => !value) }}>
            <span aria-hidden="true">⊟</span> {t('trajectory.toolbarCalls')}
          </button>
        </div>
        <label className="rear-refinement-native-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            aria-label={t('trajectory.search')}
            placeholder={t('trajectory.searchPlaceholder')}
            value={searchQuery}
            onChange={event => { setSearchQuery(event.currentTarget.value) }}
          />
        </label>
      </div>
      <TrajectoryOverview records={records} actualDuration={actualDuration} selectedKey={selectedKey} onSelect={select} t={t} />
      <div className="rear-refinement-native-ledger">
        <div className="rear-refinement-native-table-pane">
          {visibleRecords.length === 0
            ? <div className="rear-refinement-empty">{records.length === 0 ? t('trajectory.empty') : t('trajectory.noMatches')}</div>
            : <table className="rear-refinement-native-table">
                <colgroup><col className="rear-refinement-native-event-column" /><col /></colgroup>
                <tbody>
                  {visibleRecords.map((record, index) => {
                    const previous = visibleRecords[index - 1]
                    const kind = recordKind(record)
                    const firstNonSystemInTurn = kind !== 'system' && (previous === undefined || previous.row.turn !== record.row.turn || recordKind(previous) === 'system')
                    const error = record.row.isError === true || record.result?.isError === true
                    if (record.collapsedSummary !== undefined) {
                      return <tr className="rear-refinement-native-collapsed" key={record.row.key}><td /><td>{record.collapsedSummary}</td></tr>
                    }
                    return (
                      <tr
                        key={record.row.key}
                        tabIndex={0}
                        data-kind={kind}
                        data-error={error}
                        data-selected={selectedKey === record.row.key}
                        data-turn-start={firstNonSystemInTurn}
                        onClick={() => { select(record.row.key) }}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') select(record.row.key) }}
                      >
                        <td className="rear-refinement-native-event-cell">
                          {firstNonSystemInTurn && record.row.turn !== null && <span className="rear-refinement-native-turn-label">{t('trajectory.turn')} {record.row.turn}</span>}
                          {kind !== 'system' && <span className="rear-refinement-native-turn-rail" aria-hidden="true" />}
                          <span className="rear-refinement-native-kind" data-kind={kind}>{kindLabel(record)}</span>
                        </td>
                        <td className="rear-refinement-native-content" title={recordSummary(record)}>
                          {kind === 'tool' && record.row.subject !== null && <strong>{record.row.subject}</strong>}
                          {kind === 'tool' && record.row.subject !== null && record.row.summary !== '' && <span> {record.row.summary}</span>}
                          {kind === 'tool' && record.result !== null && <><span className="rear-refinement-native-arrow"> → </span><span data-error={error}>{record.result.summary || 'No output'}</span></>}
                          {kind !== 'tool' && <span>{recordSummary(record)}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>}
        </div>
        {selected !== null && (
          <aside className="rear-refinement-native-details">
            <header>
              <div>
                <strong>{kindLabel(selected)}</strong>
                <span>{t('trajectory.turn')} {selected.row.turn ?? '—'} · {t('trajectory.step')} {selected.row.step ?? '—'} · {t('trajectory.seq')} {selected.row.seq}</span>
              </div>
              <button type="button" aria-label={t('trajectory.closeDetails')} onClick={() => { setSelectedKey(null) }}>×</button>
            </header>
            <div className="rear-refinement-native-details-tabs" role="tablist" aria-label="Event details">
              {tabs.map(tab => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  key={tab.id}
                  onClick={() => { setActiveTab(tab.id) }}
                >{tab.label}</button>
              ))}
            </div>
            <div className="rear-refinement-native-details-body" role="tabpanel">
              <DetailPanel record={selected} activeTab={activeTab} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
