import { createHash } from 'node:crypto'
import type { CanonicalTrajectoryDocument, RefinementTrajectoryPage } from './types.ts'

/** Cursor is content-addressed, so a refresh cannot splice different snapshots. */
export function trajectoryPage(document: CanonicalTrajectoryDocument, cursor: string | null, maxBytes: number): RefinementTrajectoryPage {
  const bytes = Buffer.from(JSON.stringify(document), 'utf8')
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  let offset = 0
  if (cursor !== null) {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset: number; sha256: string; runId: string }
    if (parsed.runId !== document.runId || parsed.sha256 !== digest || !Number.isSafeInteger(parsed.offset) || parsed.offset <= 0 || parsed.offset >= bytes.length
      || ((bytes[parsed.offset] as number) & 0xc0) === 0x80) throw new TypeError('Stale or invalid canonical trajectory cursor')
    offset = parsed.offset
  }
  const page = (end: number): RefinementTrajectoryPage => ({ runId: document.runId, sha256: digest, totalBytes: bytes.length,
    content: bytes.subarray(offset, end).toString('utf8'), nextCursor: end === bytes.length ? null : Buffer.from(JSON.stringify({ offset: end, sha256: digest, runId: document.runId })).toString('base64url') })
  let end = Math.min(bytes.length, offset + maxBytes)
  while (end > offset) {
    while (end > offset && end < bytes.length && ((bytes[end] as number) & 0xc0) === 0x80) end--
    const candidate = page(end), size = Buffer.byteLength(JSON.stringify({ ok: true, value: candidate }))
    if (size <= maxBytes) return candidate
    end -= Math.max(1, Math.ceil((size - maxBytes) / 6))
  }
  throw new RangeError('Canonical trajectory page limit is too small')
}
