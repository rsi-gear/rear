import { useEffect, useMemo, useRef, useState } from 'react'
import type { CanonicalTrajectoryDocument, RefinementRunView } from '../types.ts'
import { pinTraceBlock, pinTraceSelection, traceBlocks, type PinnedTraceBlock, type TraceBlock } from '../trace-blocks.ts'
import { blockDiff, visibleDiffRows } from './block-diff.ts'
import { blockKindLabel, type RefinementKey } from './locales.ts'

type Translator = (key: RefinementKey) => string
function label(block: TraceBlock, t: Translator): string { return `${block.runId.slice(-8)} · #${block.seq} · ${blockKindLabel(block.kind, t)}` }

function BlockPicker({ run, blocks, onAdd, t }: {
  readonly run: RefinementRunView; readonly blocks: readonly TraceBlock[]
  readonly onAdd: (block: PinnedTraceBlock) => void; readonly t: Translator
}) {
  const [query, setQuery] = useState('')
  const [blockId, setBlockId] = useState('')
  const [selectionNotice, setSelectionNotice] = useState(false)
  const preview = useRef<HTMLTextAreaElement>(null)
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase()
    return blocks.filter(block => `${block.kind} ${blockKindLabel(block.kind, t)} ${block.path} ${block.seq}`.toLocaleLowerCase().includes(needle))
  }, [blocks, query, t, t('diff.kindSystem')])
  const block = filtered.find(candidate => candidate.id === blockId) ?? filtered.find(candidate => candidate.kind === 'system prompt') ?? filtered[0]
  const select = (id: string) => { setBlockId(id); setSelectionNotice(false) }
  return <section className="rear-block-picker" aria-label={`${t('diff.pick')} ${run.id}`}>
    <strong title={run.id}>{run.harness.id} · {run.id.slice(-8)}</strong>
    <input type="search" aria-label={`${t('diff.search')} ${run.id.slice(-8)}`} placeholder={t('diff.search')} value={query}
      onChange={event => { setQuery(event.target.value); setSelectionNotice(false) }} />
    <select aria-label={`${t('diff.block')} ${run.id.slice(-8)}`} value={block?.id ?? ''} onChange={event => select(event.target.value)}>
      {filtered.map(item => <option key={item.id} value={item.id}>#{item.seq} · {blockKindLabel(item.kind, t)} · {item.path}</option>)}
    </select>
    {block ? <>
      <textarea ref={preview} key={block.id} readOnly rows={8} value={block.text}
        aria-label={`${t('diff.preview')} ${run.id.slice(-8)}`}
        onSelect={() => setSelectionNotice(false)} />
      <div className="rear-refinement-row">
        <button type="button" onClick={() => onAdd(pinTraceBlock(block))}>{t('diff.add')}</button>
        <button type="button" disabled={!block.text.length} onClick={() => {
          // Read the native range at click time: selection events differ between browser engines.
          const input = preview.current
          if (input && input.selectionEnd > input.selectionStart) {
            onAdd(pinTraceSelection(block, input.selectionStart, input.selectionEnd)); setSelectionNotice(false)
          } else setSelectionNotice(true)
        }}>{t('diff.addSelection')}</button>
      </div>
      {selectionNotice && <span role="status">{t('diff.selectHint')}</span>}
    </> : <p className="rear-refinement-muted">{t('diff.noBlocks')}</p>}
  </section>
}

function DiffView({ before, after, t }: { readonly before: PinnedTraceBlock; readonly after: PinnedTraceBlock; readonly t: Translator }) {
  const [all, setAll] = useState(false)
  const rows = useMemo(() => blockDiff(before.text, after.text), [before.text, after.text])
  const added = rows?.filter(row => row.kind === 'add').length ?? 0
  const removed = rows?.filter(row => row.kind === 'remove').length ?? 0
  return <div className="rear-block-diff" aria-label={t('diff.result')}>
    <div className="rear-diff-heading"><span>− {label(before, t)}</span><span>+ {label(after, t)}</span>
      <strong>{rows === null ? '—' : `+${added} / −${removed}`}</strong><label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} /> {t('diff.showAll')}</label></div>
    {before.text === after.text && <p className="rear-diff-identical">{t('diff.identical')}</p>}
    {rows === null ? <><p role="status">{t('diff.tooLarge')}</p><div className="rear-diff-fallback"><pre>{before.text}</pre><pre>{after.text}</pre></div></>
      : <div className="rear-diff-lines">{visibleDiffRows(rows, all).map((row, index) => 'omitted' in row
        ? <button className="rear-diff-fold" type="button" key={index} onClick={() => setAll(true)}>⋯ {row.omitted} {t('diff.unchanged')}</button>
        : <div key={index} className="rear-diff-line" data-kind={row.kind}>
            <span className="rear-diff-number">{row.oldLine}</span><span className="rear-diff-number">{row.newLine}</span>
            <span aria-hidden="true">{row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}</span>
            <code>{row.parts.map((part, partIndex) => <span key={partIndex} data-changed={part.changed}>{part.text}</span>)}{!row.text.endsWith('\n') && <span className="rear-diff-eof"> ↵ {t('diff.noNewline')}</span>}</code>
          </div>)}</div>}
  </div>
}

/** An arbitrary-source comparison basket. Any item can be the baseline, regardless of block type. */
export function BlockComparison({ runs, documents, errors, t }: {
  readonly runs: readonly RefinementRunView[]
  readonly documents: Readonly<Record<string, CanonicalTrajectoryDocument | null>>
  readonly errors: Readonly<Record<string, string>>
  readonly t: Translator
}) {
  const [pinned, setPinned] = useState<readonly PinnedTraceBlock[]>([])
  const [baselineId, setBaselineId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [missingSystem, setMissingSystem] = useState(false)
  const [pickerGeneration, setPickerGeneration] = useState(0)
  const [revealDiff, setRevealDiff] = useState(false)
  const diffAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (revealDiff) { diffAnchor.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); setRevealDiff(false) }
  }, [revealDiff])
  const byRun = useMemo(() => new Map(runs.map(run => {
    const document = documents[run.id]
    return [run.id, document ? traceBlocks(document) : []] as const
  })), [runs, documents])
  const add = (block: PinnedTraceBlock) => {
    setPinned(current => current.some(item => item.selectionId === block.selectionId) ? current : [...current, block])
    setTargetId(block.selectionId)
    setMissingSystem(false)
  }
  const before = pinned.find(block => block.selectionId === baselineId) ?? pinned[0]
  const after = pinned.find(block => block.selectionId === targetId && block !== before) ?? pinned.find(block => block !== before)
  return <section className="rear-block-comparison" aria-label={t('diff.title')}>
    <div className="rear-block-toolbar">
      <button type="button" onClick={() => {
        const systems = runs.flatMap(run => {
          const block = byRun.get(run.id)?.find(item => item.kind === 'system prompt')
          return block ? [pinTraceBlock(block)] : []
        })
        setPinned(systems); setBaselineId(''); setTargetId('')
        setPickerGeneration(value => value + 1)
        setRevealDiff(systems.length >= 2)
        setMissingSystem(systems.length < runs.length)
      }}>{t('diff.system')}</button></div>
    <div className="rear-block-pickers">{runs.map(run => documents[run.id]
      ? <BlockPicker key={`${run.id}:${pickerGeneration}`} run={run} blocks={byRun.get(run.id)!} onAdd={add} t={t} />
      : <p key={run.id} className="rear-refinement-muted">{run.id.slice(-8)} · {documents[run.id] === undefined ? t('loading') : errors[run.id] ?? t('trajectory.empty')}</p>)}</div>
    {missingSystem && <p role="status">{t('diff.missingSystem')}</p>}
    {pinned.length > 0 && <div ref={diffAnchor} className="rear-diff-basket">
      <strong>{t('diff.basket')} · {pinned.length}</strong>
      <button type="button" disabled={!pinned.length} onClick={() => { setPinned([]); setBaselineId(''); setTargetId('') }}>{t('diff.clear')}</button>
      {pinned.map(block => <div key={block.selectionId} className="rear-diff-pin" title={`${block.runId} / ${block.path}`}>
        <label><input type="radio" name="rear-diff-baseline" checked={block === before} onChange={() => setBaselineId(block.selectionId)} />{t('diff.baseline')}</label>
        <button type="button" disabled={block === before} aria-pressed={block === after} title={`${label(block, t)} · [${block.start}:${block.end}]`}
          onClick={() => setTargetId(block.selectionId)}>{label(block, t)} · [{block.start}:{block.end}]</button>
        <button type="button" aria-label={`${t('diff.remove')} ${label(block, t)}`} onClick={() => setPinned(current => current.filter(item => item !== block))}>×</button>
      </div>)}
    </div>}
    {before && after && <DiffView key={`${before.selectionId}:${after.selectionId}`} before={before} after={after} t={t} />}
  </section>
}
