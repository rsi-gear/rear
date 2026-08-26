import { describe, expect, it } from 'vitest'
import { buildOfflineTrajectoryRows } from '../../src/client/OfflineTrajectorySurface.tsx'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'

describe('offline trajectory surface', () => {
  it('projects canonical lifecycle, assistant, and tool evidence into timeline rows', () => {
    const document = {
      runId: 'run-1',
      header: { version: 0, id: 'trajectory-run-1', createdAt: 1_000 },
      events: [
        { type: 'turn/start', seq: 0, time: 1_000, data: { turn: 1 } },
        { type: 'assistant/chunk', seq: 1, time: 1_025, data: { turn: 1, step: 1, chunk: { type: 'text', text: 'Inspecting…' } } },
        { type: 'tool/call', seq: 2, time: 1_050, data: { turn: 1, step: 1, name: 'fixture.verify', arguments: { task: 'unicode-paths' } } },
        { type: 'tool/result', seq: 3, time: 1_075, data: { turn: 1, step: 1, result: { ok: true } } },
        { type: 'assistant/message', seq: 4, time: 1_100, data: { turn: 1, step: 1, message: { content: [
          { type: 'reasoning', text: 'Inspecting…' },
          { type: 'tool-call', id: 'call-1', name: 'fixture.verify', arguments: '{}' },
          { type: 'text', text: 'Done.' },
        ] } } },
      ],
    } as unknown as CanonicalTrajectoryDocument

    const rows = buildOfflineTrajectoryRows(document)

    expect(rows).toHaveLength(4)
    expect(rows.map(row => row.kind)).toEqual([
      'lifecycle', 'tool-call', 'tool-result', 'assistant',
    ])
    expect(rows[1]).toMatchObject({ subject: 'fixture.verify', summary: '{"task":"unicode-paths"}' })
    expect(rows[2]?.summary).toBe('{"ok":true}')
    expect(rows[3]).toMatchObject({ elapsedMs: 100, turn: 1, step: 1, summary: 'Inspecting…\n\nDone.' })
  })

  it('coalesces an unfinished assistant stream into one fallback row', () => {
    const document = {
      runId: 'run-stream',
      header: { version: 0, id: 'trajectory-stream', createdAt: 3_000 },
      events: [
        { type: 'assistant/chunk', seq: 10, time: 3_010, data: { turn: 1, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
        { type: 'assistant/chunk', seq: 11, time: 3_020, data: { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: 'Let' } } },
        { type: 'assistant/chunk', seq: 12, time: 3_030, data: { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: ' me' } } },
        { type: 'assistant/chunk', seq: 13, time: 3_040, data: { turn: 1, step: 2, chunk: { type: 'block-end', index: 0 } } },
      ],
    } as unknown as CanonicalTrajectoryDocument

    expect(buildOfflineTrajectoryRows(document)).toMatchObject([{
      key: '10:assistant/stream', type: 'assistant/stream', kind: 'assistant',
      turn: 1, step: 2, summary: 'Let me',
    }])
  })

  it('keeps unknown canonical events inspectable instead of dropping them', () => {
    const document = {
      runId: 'run-2',
      header: { version: 0, id: 'trajectory-run-2', createdAt: 2_000 },
      events: [{ type: 'provider/custom', seq: 9, time: 2_500, data: { value: 42 } }],
    } as unknown as CanonicalTrajectoryDocument

    expect(buildOfflineTrajectoryRows(document)[0]).toMatchObject({
      kind: 'event', subject: 'provider/custom', summary: '{"value":42}', elapsedMs: 0,
    })
  })
})
