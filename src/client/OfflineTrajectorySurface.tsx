import { useMemo, useState } from 'react'
import type {
  CanonicalTrajectoryDocument,
  CanonicalTrajectoryEvent,
  RefinementJsonValue,
} from '../types.ts'
import type { RefinementKey } from './locales.ts'

type JsonObject = { readonly [key: string]: RefinementJsonValue }

export type OfflineTrajectoryKind = 'assistant' | 'tool-call' | 'tool-result' | 'lifecycle' | 'event'

/** Presentation row derived from one canonical Session event. */
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

function assistantContentText(value: RefinementJsonValue | undefined): string {
  if (!Array.isArray(value)) return text(value)
  return value.map(item => {
    const content = object(item)
    const type = string(content?.type)
    if (type !== 'reasoning' && type !== 'text') return ''
    return text(content?.text ?? content?.content)
  }).filter(Boolean).join('\n\n')
}

function assistantLocation(event: CanonicalTrajectoryEvent): string | null {
  const data = object(event.data)
  const turn = number(data?.turn)
  const step = number(data?.step)
  return turn === null || step === null ? null : `${turn}:${step}`
}

function streamedAssistantText(events: readonly CanonicalTrajectoryEvent[]): string {
  let previousBlock: number | null = null
  let output = ''
  for (const event of events) {
    const chunk = object(object(event.data)?.chunk)
    const value = string(chunk?.text)
    if (value === null) continue
    const block = number(chunk?.index)
    if (output !== '' && block !== null && previousBlock !== null && block !== previousBlock) output += '\n\n'
    output += value
    if (block !== null) previousBlock = block
  }
  return output
}

function eventPresentation(event: CanonicalTrajectoryEvent): {
  kind: OfflineTrajectoryKind
  subject: string | null
  callId: string | null
  summary: string
} {
  const data = object(event.data)
  switch (event.type) {
    case 'assistant/chunk':
      return { kind: 'assistant', subject: null, callId: null, summary: text(data?.chunk) }
    case 'assistant/message': {
      const message = object(data?.message)
      return { kind: 'assistant', subject: null, callId: null, summary: assistantContentText(message?.content ?? data?.content) }
    }
    case 'tool/call':
      return {
        kind: 'tool-call',
        subject: string(data?.name) ?? string(data?.tool) ?? string(data?.callId) ?? string(data?.id),
        callId: string(data?.callId) ?? string(data?.id),
        summary: text(data?.arguments ?? data?.input),
      }
    case 'tool/result':
      return {
        kind: 'tool-result',
        subject: string(data?.name) ?? string(data?.tool) ?? string(data?.callId) ?? string(data?.id),
        callId: string(data?.callId) ?? string(data?.id),
        summary: text(data?.result ?? data?.output),
      }
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
    case 'session/end':
      return { kind: 'lifecycle', subject: event.type, callId: null, summary: text(data?.reason ?? data?.error) }
    default:
      return { kind: 'event', subject: event.type, callId: null, summary: text(event.data) }
  }
}

/** Convert the Remote-safe canonical document into stable timeline rows. */
export function buildOfflineTrajectoryRows(document: CanonicalTrajectoryDocument): readonly OfflineTrajectoryRow[] {
  const origin = document.events[0]?.time ?? document.header.createdAt
  // Canonical sessions retain provider streaming deltas for fidelity. Once a
  // step has its authoritative assistant/message, those deltas are transport
  // detail rather than separate ledger messages.
  const finalizedAssistantLocations = new Set(document.events.flatMap(event => {
    const location = event.type === 'assistant/message' ? assistantLocation(event) : null
    return location === null ? [] : [location]
  }))
  const unfinishedStreams = new Map<string, CanonicalTrajectoryEvent[]>()
  for (const event of document.events) {
    if (event.type !== 'assistant/chunk') continue
    const location = assistantLocation(event)
    if (location === null || finalizedAssistantLocations.has(location)) continue
    const events = unfinishedStreams.get(location) ?? []
    events.push(event)
    unfinishedStreams.set(location, events)
  }
  return document.events.flatMap(event => {
    if (event.type === 'assistant/chunk') {
      const location = assistantLocation(event)
      if (location === null || finalizedAssistantLocations.has(location)) return []
      const events = unfinishedStreams.get(location)
      if (events === undefined || events[0] !== event) return []
      const summary = streamedAssistantText(events)
      if (summary === '') return []
      const data = object(event.data)
      const last = events.at(-1) as CanonicalTrajectoryEvent
      return [{
        key: `${event.seq}:assistant/stream`,
        type: 'assistant/stream',
        seq: event.seq,
        time: event.time,
        elapsedMs: Math.max(0, event.time - origin),
        turn: number(data?.turn),
        step: number(data?.step),
        kind: 'assistant' as const,
        subject: null,
        callId: null,
        summary,
        detail: json({
          type: 'assistant/stream',
          sourceEventCount: events.length,
          sourceSeqStart: event.seq,
          sourceSeqEnd: last.seq,
          data: { turn: data?.turn ?? null, step: data?.step ?? null, content: summary },
        }, true),
      }]
    }
    const data = object(event.data)
    return [{
      key: `${event.seq}:${event.type}`,
      type: event.type,
      seq: event.seq,
      time: event.time,
      elapsedMs: Math.max(0, event.time - origin),
      turn: number(data?.turn),
      step: number(data?.step),
      ...eventPresentation(event),
      detail: json(event, true),
    }]
  })
}

interface LedgerRecord {
  readonly row: OfflineTrajectoryRow
  readonly result: OfflineTrajectoryRow | null
}

function ledgerRecords(rows: readonly OfflineTrajectoryRow[]): readonly LedgerRecord[] {
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

function recordKind(record: LedgerRecord): 'assistant' | 'tool' | 'event' {
  if (record.row.kind === 'assistant') return 'assistant'
  if (record.row.kind === 'tool-call' || record.row.kind === 'tool-result') return 'tool'
  return 'event'
}

function kindLabel(record: LedgerRecord, t: (key: RefinementKey) => string): string {
  switch (recordKind(record)) {
    case 'assistant': return t('trajectory.assistant').toLocaleUpperCase()
    case 'tool': return t('trajectory.kindTool').toLocaleUpperCase()
    case 'event': return t('trajectory.event').toLocaleUpperCase()
  }
}

function recordSearchText(record: LedgerRecord): string {
  return [record.row.type, record.row.subject, record.row.summary, record.row.detail,
    record.result?.summary, record.result?.detail].filter(Boolean).join('\n').toLocaleLowerCase()
}

function recordDetail(record: LedgerRecord): string {
  return record.result === null ? record.row.detail : `${record.row.detail}\n\n${record.result.detail}`
}

function recordSummary(record: LedgerRecord): string {
  if (recordKind(record) !== 'tool') return record.row.summary || record.row.type
  const request = [record.row.subject, record.row.summary].filter(Boolean).join(' ')
  return record.result === null || record.result.summary === ''
    ? request
    : `${request}  →  ${record.result.summary}`
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
  if (collapsedCalls) visible = visible.filter(record => recordKind(record) !== 'tool')
  if (!collapsedTurns) return visible
  const seen = new Set<number | null>()
  return visible.filter(record => {
    if (seen.has(record.row.turn)) return false
    seen.add(record.row.turn)
    return true
  })
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
  const total = Math.max(1, records.at(-1)?.row.elapsedMs ?? 1)
  return (
    <div className="rear-refinement-native-timeline" role="region" aria-label={t('trajectory.timeline')}>
      <div className="rear-refinement-native-timeline-labels" aria-hidden="true">
        <span>{t('trajectory.input')}</span><span>{t('trajectory.model')}</span><span>{t('trajectory.tools')}</span>
      </div>
      <div className="rear-refinement-native-timeline-track">
        {records.map((record, index) => {
          const next = records[index + 1]
          const left = actualDuration ? (record.row.elapsedMs / total) * 100 : (index / records.length) * 100
          const width = actualDuration
            ? Math.max(1.5, (((next?.row.elapsedMs ?? total) - record.row.elapsedMs) / total) * 100)
            : Math.max(1.5, 100 / records.length)
          return (
            <button
              type="button"
              key={record.row.key}
              className="rear-refinement-native-timeline-span"
              data-kind={recordKind(record)}
              data-selected={selectedKey === record.row.key}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
              title={`${kindLabel(record, t)} · ${recordSummary(record)}`}
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
  const visibleRecords = useMemo(
    () => displayRecords(records, searchQuery, collapsedTurns, collapsedCalls),
    [collapsedCalls, collapsedTurns, records, searchQuery],
  )
  const selected = records.find(record => record.row.key === selectedKey) ?? null
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
      <TrajectoryOverview records={records} actualDuration={actualDuration} selectedKey={selectedKey} onSelect={setSelectedKey} t={t} />
      <div className="rear-refinement-native-ledger">
        <div className="rear-refinement-native-table-pane">
          {visibleRecords.length === 0
            ? <div className="rear-refinement-empty">{records.length === 0 ? t('trajectory.empty') : t('trajectory.noMatches')}</div>
            : <table className="rear-refinement-native-table">
                <colgroup><col className="rear-refinement-native-event-column" /><col /></colgroup>
                <tbody>
                  {visibleRecords.map((record, index) => {
                    const previous = visibleRecords[index - 1]
                    const next = visibleRecords[index + 1]
                    const turnStart = previous === undefined || previous.row.turn !== record.row.turn
                    const turnEnd = next === undefined || next.row.turn !== record.row.turn
                    const kind = recordKind(record)
                    return (
                      <tr
                        key={record.row.key}
                        tabIndex={0}
                        data-kind={kind}
                        data-selected={selectedKey === record.row.key}
                        data-turn-start={turnStart}
                        data-turn-end={turnEnd}
                        onClick={() => { setSelectedKey(record.row.key) }}
                        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelectedKey(record.row.key) }}
                      >
                        <td className="rear-refinement-native-event-cell">
                          {turnStart && record.row.turn !== null && <span className="rear-refinement-native-turn-label">{t('trajectory.turn')} {record.row.turn}</span>}
                          <span className="rear-refinement-native-turn-rail" aria-hidden="true" />
                          <span className="rear-refinement-native-kind" data-kind={kind}>{kindLabel(record, t)}</span>
                        </td>
                        <td className="rear-refinement-native-content" title={recordSummary(record)}>
                          {kind === 'tool' && record.row.subject !== null && <strong>{record.row.subject}</strong>}
                          {kind === 'tool' && record.row.subject !== null && record.row.summary !== '' && <span> {record.row.summary}</span>}
                          {kind === 'tool' && record.result !== null && <><span className="rear-refinement-native-arrow"> → </span><span>{record.result.summary}</span></>}
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
                <strong>{kindLabel(selected, t)}</strong>
                <span>{t('trajectory.turn')} {selected.row.turn ?? '—'} · {t('trajectory.step')} {selected.row.step ?? '—'} · {t('trajectory.seq')} {selected.row.seq}</span>
              </div>
              <button type="button" aria-label={t('trajectory.closeDetails')} onClick={() => { setSelectedKey(null) }}>×</button>
            </header>
            <div className="rear-refinement-native-details-tabs"><span>{t('trajectory.details')}</span></div>
            <div className="rear-refinement-native-details-preview">{recordSummary(selected)}</div>
            <pre>{recordDetail(selected)}</pre>
          </aside>
        )}
      </div>
    </div>
  )
}
