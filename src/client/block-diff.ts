import { diffLines, diffWordsWithSpace } from 'diff'

export interface DiffPart { readonly text: string; readonly changed: boolean }
export interface DiffRow {
  readonly kind: 'equal' | 'remove' | 'add'
  readonly oldLine: number | null
  readonly newLine: number | null
  readonly text: string
  readonly parts: readonly DiffPart[]
}

/** Bounded line alignment plus intraline emphasis; never silently drops source text. */
export function blockDiff(before: string, after: string): readonly DiffRow[] | null {
  const changes = diffLines(before, after, { timeout: 500, maxEditLength: 10_000 })
  if (changes === undefined) return null
  const rows: DiffRow[] = []
  let oldLine = 1, newLine = 1
  for (const change of changes) {
    const lines = change.value.match(/[^\n]*\n|[^\n]+$/gu) ?? []
    for (const text of lines) rows.push({
      kind: change.added ? 'add' : change.removed ? 'remove' : 'equal',
      oldLine: change.added ? null : oldLine++, newLine: change.removed ? null : newLine++, text,
      parts: [{ text, changed: false }],
    })
  }
  const emphasisDeadline = Date.now() + 150
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.kind !== 'remove') continue
    let end = i
    while (rows[end]?.kind === 'remove') end++
    let addedEnd = end
    while (rows[addedEnd]?.kind === 'add') addedEnd++
    for (let j = 0; j < Math.min(end - i, addedEnd - end); j++) {
      if (Date.now() >= emphasisDeadline) return rows
      const left = rows[i + j]!, right = rows[end + j]!
      const words = diffWordsWithSpace(left.text, right.text, { timeout: 20, maxEditLength: 2000 })
      if (words === undefined) continue
      rows[i + j] = { ...left, parts: words.filter(word => !word.added).map(word => ({ text: word.value, changed: word.removed })) }
      rows[end + j] = { ...right, parts: words.filter(word => !word.removed).map(word => ({ text: word.value, changed: word.added })) }
    }
    i = addedEnd - 1
  }
  return rows
}

/** Three context lines around each edit, with explicit fold markers. */
export function visibleDiffRows(rows: readonly DiffRow[], all: boolean): readonly (DiffRow | { readonly omitted: number })[] {
  if (all) return rows
  const keep = new Set<number>()
  rows.forEach((row, index) => {
    if (row.kind !== 'equal') for (let i = Math.max(0, index - 3); i <= Math.min(rows.length - 1, index + 3); i++) keep.add(i)
  })
  const result: (DiffRow | { omitted: number })[] = []
  let omitted = 0
  rows.forEach((row, index) => {
    if (keep.has(index)) {
      if (omitted) result.push({ omitted })
      omitted = 0
      result.push(row)
    } else omitted++
  })
  if (omitted) result.push({ omitted })
  return result
}
