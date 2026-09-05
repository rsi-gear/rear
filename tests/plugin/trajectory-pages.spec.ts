import { describe, expect, it } from 'vitest'
import { trajectoryPage } from '../../src/trajectory-pages.ts'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'

describe('bounded canonical trajectory transport', () => {
  it('losslessly splits a single oversized event across UTF-8/escaped JSON pages', () => {
    const document = { runId: 'run-test', header: { type: 'session', version: 0, id: 's', createdAt: 1 }, records: [{ type: 'assistant/message', seq: 0, time: 1, data: { text: '中文😀"\\\n'.repeat(2500) } }] } as unknown as CanonicalTrajectoryDocument
    let cursor: string | null = null
    const contents: string[] = []
    do {
      const page = trajectoryPage(document, cursor, 1024)
      expect(Buffer.byteLength(JSON.stringify({ ok: true, value: page }))).toBeLessThanOrEqual(1024)
      expect(page.content).not.toContain('\ufffd')
      contents.push(page.content); cursor = page.nextCursor
    } while (cursor)
    expect(contents.length).toBeGreaterThan(2)
    expect(JSON.parse(contents.join(''))).toEqual(document)
  })
  it('rejects cursors from a replaced run or document', () => {
    const document = { runId: 'run-test', header: {}, records: [{ text: 'x'.repeat(2000) }] } as unknown as CanonicalTrajectoryDocument
    const page = trajectoryPage(document, null, 600)
    expect(() => trajectoryPage({ ...document, records: [] }, page.nextCursor, 600)).toThrow(/cursor/)
    expect(() => trajectoryPage(document, 'bad-cursor', 600)).toThrow()
  })
})
