import { describe, expect, it } from 'vitest'
import {
  buildOfflineTrajectoryRecords,
  buildOfflineTrajectoryRows,
} from '../../src/client/OfflineTrajectorySurface.tsx'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'

function nativeDocument(): CanonicalTrajectoryDocument {
  return {
    runId: 'run-1',
    header: { version: 0, id: 'trajectory-run-1', createdAt: 1_000 },
    events: [
      { type: 'permission/preset', seq: 0, time: 1_001, data: { preset: 'danger-full-access' }, ignorable: true },
      { type: 'turn/start', seq: 1, time: 1_010, data: { turn: 1 } },
      { type: 'step/start', seq: 2, time: 1_020, data: { turn: 1, step: 1 } },
      { type: 'user/message', seq: 3, time: 1_021, data: {
        id: 'user-1', role: 'user', source: { kind: 'user' },
        content: [{ type: 'text', text: 'Inspect the fixture.' }],
      }, surfaceOp: 'append' },
      { type: 'user/message', seq: 4, time: 1_022, data: {
        id: 'context-1', role: 'user', source: { kind: 'plugin', plugin: 'runtime-context' },
        content: [{ type: 'text', text: 'Current runtime context.' }],
      }, surfaceOp: 'append' },
      // Native DSH logs the initial request header after input messages. Its
      // trajectory layout nevertheless presents this as the first SYSTEM row.
      { type: 'request/header', seq: 5, time: 1_023, data: { reason: 'initial', header: {
        config: { provider: 'deepseek', model: 'test' },
        system: 'You are a coding agent.',
        tools: [{ name: 'fixture.verify', description: 'Verify a fixture', parameters: { type: 'object' } }],
      } } },
      { type: 'assistant/chunk', seq: 6, time: 1_025, data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
      { type: 'assistant/chunk', seq: 7, time: 1_030, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'Inspecting…' } } },
      { type: 'assistant/message', seq: 8, time: 1_040, data: { turn: 1, step: 1, message: {
        id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'test' },
        content: [
          { type: 'reasoning', text: 'Inspecting…' },
          { type: 'tool-call', id: 'call-1', name: 'fixture.verify', arguments: '{"task":"unicode-paths"}' },
        ],
      }, usage: { inputTokens: 7, outputTokens: 3 } }, surfaceOp: 'append' },
      { type: 'tool/call', seq: 9, time: 1_041, data: { turn: 1, step: 1, callId: 'call-1', name: 'fixture.verify', arguments: '{"task":"unicode-paths"}' } },
      { type: 'tool/result', seq: 10, time: 1_075, data: { turn: 1, step: 1, message: {
        id: 'result-1', role: 'user', source: { kind: 'tool', callId: 'call-1' },
        content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '{"ok":true}' }], isError: false }],
      } }, surfaceOp: 'append' },
      { type: 'step/end', seq: 11, time: 1_080, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 12, time: 1_090, data: { turn: 1, reason: { kind: 'completed' } } },
    ],
  } as unknown as CanonicalTrajectoryDocument
}

describe('offline trajectory surface', () => {
  it('matches native DSH role order and hides ignorable runtime events', () => {
    const rows = buildOfflineTrajectoryRows(nativeDocument())

    expect(rows.map(row => row.kind)).toEqual([
      'system', 'user', 'context', 'assistant', 'tool-call', 'tool-result',
    ])
    expect(rows.map(row => row.summary)).not.toContain('{"preset":"danger-full-access"}')
    expect(rows[0]).toMatchObject({
      type: 'request/header', summary: 'Initial System Prompt', detail: 'You are a coding agent.',
    })
    expect(rows[1]).toMatchObject({ kind: 'user', summary: 'Inspect the fixture.' })
    expect(rows[2]).toMatchObject({ kind: 'context', summary: 'Current runtime context.' })
  })

  it('pairs native nested tool results into one ledger record', () => {
    const records = buildOfflineTrajectoryRecords(nativeDocument())

    expect(records).toHaveLength(5)
    const tool = records.find(record => record.row.kind === 'tool-call')
    expect(tool).toMatchObject({
      row: {
        callId: 'call-1', subject: 'fixture.verify', summary: '{"task":"unicode-paths"}',
      },
      result: { callId: 'call-1', summary: '{"ok":true}', isError: false },
    })
    expect(tool?.row.schemaDetail).toContain('Verify a fixture')
  })

  it('uses final assistant text without concatenating hidden reasoning and records TTFT', () => {
    const document = nativeDocument()
    const assistant = document.events.find(event => event.type === 'assistant/message')
    if (assistant === undefined) throw new Error('fixture assistant is missing')
    const replacement = {
      ...assistant,
      data: {
        ...(assistant.data as object),
        message: {
          ...((assistant.data as { message: object }).message),
          content: [
            { type: 'reasoning', text: 'Private reasoning.' },
            { type: 'text', text: 'Visible answer.' },
          ],
        },
      },
    }
    const rows = buildOfflineTrajectoryRows({
      ...document,
      events: document.events.map(event => event === assistant ? replacement : event),
    } as CanonicalTrajectoryDocument)
    const row = rows.find(candidate => candidate.kind === 'assistant')

    expect(row).toMatchObject({
      summary: 'Visible answer.', outputDetail: 'Visible answer.',
      thinkingDetail: 'Private reasoning.',
      timing: { stepStartTime: 1_020, firstTokenTime: 1_030, completedTime: 1_040 },
    })
  })

  it('coalesces an unfinished assistant stream into one fallback row', () => {
    const document = {
      runId: 'run-stream',
      header: { version: 0, id: 'trajectory-stream', createdAt: 3_000 },
      events: [
        { type: 'turn/start', seq: 0, time: 3_001, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 3_005, data: { turn: 1, step: 2 } },
        { type: 'assistant/chunk', seq: 2, time: 3_010, data: { turn: 1, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } } },
        { type: 'assistant/chunk', seq: 3, time: 3_020, data: { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: 'Let' } } },
        { type: 'assistant/chunk', seq: 4, time: 3_030, data: { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: ' me' } } },
      ],
    } as unknown as CanonicalTrajectoryDocument

    expect(buildOfflineTrajectoryRows(document)).toMatchObject([{
      key: '2:assistant/stream', type: 'assistant/stream', kind: 'assistant',
      turn: 1, step: 2, summary: 'Let me',
    }])
  })

  it('keeps unknown required events inspectable but omits unknown ignorable events', () => {
    const document = {
      runId: 'run-2',
      header: { version: 0, id: 'trajectory-run-2', createdAt: 2_000 },
      events: [
        { type: 'provider/noise', seq: 0, time: 2_100, data: { hidden: true }, ignorable: true },
        { type: 'provider/custom', seq: 1, time: 2_500, data: { value: 42 } },
      ],
    } as unknown as CanonicalTrajectoryDocument

    expect(buildOfflineTrajectoryRows(document)).toMatchObject([{
      kind: 'event', subject: 'provider/custom', summary: '{"value":42}', elapsedMs: 500,
    }])
  })
})
