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
        { type: 'assistant/message', seq: 4, time: 1_100, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'Done.' }] } } },
      ],
    } as unknown as CanonicalTrajectoryDocument

    const rows = buildOfflineTrajectoryRows(document)

    expect(rows).toHaveLength(5)
    expect(rows.map(row => row.kind)).toEqual([
      'lifecycle', 'assistant', 'tool-call', 'tool-result', 'assistant',
    ])
    expect(rows[1]).toMatchObject({ elapsedMs: 25, turn: 1, step: 1, summary: 'Inspecting…' })
    expect(rows[2]).toMatchObject({ subject: 'fixture.verify', summary: '{"task":"unicode-paths"}' })
    expect(rows[3]?.summary).toBe('{"ok":true}')
    expect(rows[4]?.summary).toBe('Done.')
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
