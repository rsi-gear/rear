import { describe, expect, it } from 'vitest'
import { blockDiff, visibleDiffRows } from '../../src/client/block-diff.ts'
import { pinTraceBlock, pinTraceSelection, traceBlocks } from '../../src/trace-blocks.ts'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'

describe('arbitrary trace block selection and diff', () => {
  it('extracts exact system prompts, different message types, and unknown-event fallbacks', () => {
    const blocks = traceBlocks({ runId: 'r', header: {}, records: [
      { type: 'request/header', seq: 1, time: 1, data: { header: { system: '你是助手\nkeep whitespace  ', tools: [] } } },
      { type: 'assistant/message', seq: 2, time: 2, data: { message: { content: [{ type: 'reasoning', text: 'reasoning' }, { type: 'text', text: 'answer' }] } } },
      { type: 'custom/event', seq: 3, time: 3, data: { arbitrary: true } },
    ] } as unknown as CanonicalTrajectoryDocument)
    expect(blocks.find(block => block.kind === 'system prompt')?.text).toBe('你是助手\nkeep whitespace  ')
    expect(blocks.find(block => block.kind === 'assistant/message / reasoning')?.text).toBe('reasoning')
    expect(blocks.find(block => block.kind === 'custom/event')?.text).toBe('{\n  "arbitrary": true\n}')
    const excerpt = pinTraceBlock(blocks[0]!, 0, 4)
    expect(excerpt.text).toBe('你是助手')
    expect(excerpt).toMatchObject({ runId: 'r', seq: 1, start: 0, end: 4 })
    expect(() => pinTraceBlock(blocks[0]!, -1)).toThrow()
  })

  it('highlights additions, deletions and exact words with reconstructable sources', () => {
    const before = 'shared\nChoose Alice first.\nold\n', after = 'shared\nChoose Bob first.\nnew\n'
    const rows = blockDiff(before, after)!
    expect(rows.filter(row => row.kind !== 'add').map(row => row.text).join('')).toBe(before)
    expect(rows.filter(row => row.kind !== 'remove').map(row => row.text).join('')).toBe(after)
    expect(rows.find(row => row.text.includes('Alice'))?.parts).toContainEqual({ text: 'Alice', changed: true })
    expect(rows.find(row => row.text.includes('Bob'))?.parts).toContainEqual({ text: 'Bob', changed: true })
    expect(rows.find(row => row.kind === 'add')).toMatchObject({ oldLine: null, newLine: 2 })
  })

  it('maps textarea selections back to exact CRLF source offsets without normalizing evidence', () => {
    const block = { id: 'r:1:system', runId: 'r', seq: 1, path: 'header.system', kind: 'system prompt', text: 'first\r\n你好🙂\r\nlast' }
    const selected = pinTraceSelection(block, 6, 12)
    expect(selected).toMatchObject({ start: 7, end: 14, text: '你好🙂\r\nl' })
    expect(pinTraceSelection(block, 0, 6).text).toBe('first\r\n')
    expect(pinTraceSelection(block, 6, 6)).toMatchObject({ start: 7, end: 7, text: '' })
    expect(() => pinTraceSelection(block, 0, 100)).toThrow(RangeError)
  })

  it('preserves empty blocks, Unicode, whitespace, and a missing final newline', () => {
    for (const [before, after] of [['', '你好🙂'], ['a\n', 'a'], [' a\n', 'a\n'], ['相同', '相同'], ['a\r\n', 'a\n']]) {
      const rows = blockDiff(before!, after!)!
      expect(rows.filter(row => row.kind !== 'add').map(row => row.text).join('')).toBe(before)
      expect(rows.filter(row => row.kind !== 'remove').map(row => row.text).join('')).toBe(after)
    }
  })

  it('folds only unchanged lines and can expand the original complete result', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}\n`).join('')
    const rows = blockDiff(before, before.replace('line 20', 'changed 20'))!
    const visible = visibleDiffRows(rows, false)
    expect(visible.some(row => 'omitted' in row)).toBe(true)
    expect(visible.filter(row => 'kind' in row && row.kind !== 'equal')).toHaveLength(2)
    expect(visibleDiffRows(rows, true)).toBe(rows)
  })
})
