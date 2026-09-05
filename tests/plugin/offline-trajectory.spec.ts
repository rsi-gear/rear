import { describe, expect, it } from 'vitest'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'
import {
  canonicalTrajectoryInputs,
  resolveDshTrajectoryComponent,
} from '../../src/client/DshOfflineTrajectorySurface.tsx'
import { REFINEMENT_STYLES } from '../../src/client/styles.ts'

function document(): CanonicalTrajectoryDocument {
  return {
    runId: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as CanonicalTrajectoryDocument['runId'],
    header: {
      type: 'session', version: 0, id: 'session-test', createdAt: 1_000,
    } as unknown as CanonicalTrajectoryDocument['header'],
    records: [
      { type: 'turn/start', seq: 0, time: 1_001, data: { turn: 1 } },
      { type: 'runtime/noise', seq: 1, time: 1_002, data: { value: 'raw-only' }, ignorable: true },
    ],
  }
}

describe('DSH offline trajectory bridge', () => {
  it('resolves the component registered by DSH instead of maintaining a second renderer', () => {
    const component = () => null
    expect(resolveDshTrajectoryComponent([
      { options: { id: 'chat' }, component: () => null },
      { options: { id: 'trajectory' }, component },
    ])).toBe(component)
    expect(() => resolveDshTrajectoryComponent([])).toThrow(/registered DSH trajectory/u)
  })

  it('hands every canonical event envelope to DSH without local filtering or rewriting', () => {
    const source = document()
    const inputs = canonicalTrajectoryInputs(source)
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.event).toBe(source.records[0])
    expect(inputs[1]?.event).toBe(source.records[1])
    expect(inputs.map(input => input.view)).toEqual([undefined, undefined])
  })

  it('losslessly expands packed assistant deltas before DSH projection', () => {
    const source = document()
    const inputs = canonicalTrajectoryInputs({
      ...source,
      records: [{
        type: 'text-chunks', seq0: 4, time0: 2_000,
        data: { turn: 1, step: 2, index: 0, dt: [2, 3], texts: ['a', 'b', 'c'] },
      }],
    })
    expect(inputs.map(input => input.event)).toEqual([
      { type: 'assistant/chunk', seq: 4, time: 2_000, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'a' } } },
      { type: 'assistant/chunk', seq: 5, time: 2_002, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'b' } } },
      { type: 'assistant/chunk', seq: 6, time: 2_005, data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'c' } } },
    ])
  })

  it('reserves the live composer outside the nested DSH trajectory surface', () => {
    const rootRule = REFINEMENT_STYLES.match(/\.rear-refinement-root\{([^}]*)\}/u)?.[1]
    const trajectoryRule = REFINEMENT_STYLES.match(/\.rear-refinement-dsh-trajectory\{([^}]*)\}/u)?.[1]
    expect(rootRule).toContain('padding:0 28px calc(var(--dsh-composer-height,152px) + 48px)')
    expect(rootRule).toContain('scroll-padding-bottom:calc(var(--dsh-composer-height,152px) + 16px)')
    expect(REFINEMENT_STYLES).toContain(
      '.rear-refinement-root{padding:0 16px calc(var(--dsh-composer-height,152px) + 32px)}',
    )
    expect(trajectoryRule).toBeDefined()
    expect(trajectoryRule).toContain('--dsh-composer-height:0px')
  })

  it('wraps long lane evidence without stretching or clipping its controls', () => {
    expect(REFINEMENT_STYLES).toContain('.rear-refinement-lane-header>*{min-width:0;max-width:100%}')
    expect(REFINEMENT_STYLES).toContain(
      '.rear-refinement-lane-header>.rear-refinement-muted{overflow-wrap:anywhere;white-space:normal}',
    )
    expect(REFINEMENT_STYLES).toContain('.rear-refinement-lane-header>button{justify-self:start}')
  })

  it('keeps REAR element defaults outside the native DSH trajectory subtree', () => {
    expect(REFINEMENT_STYLES).toContain(
      '.rear-refinement-root *:not(.rear-refinement-dsh-trajectory *){box-sizing:border-box}',
    )
    expect(REFINEMENT_STYLES).toContain(
      '.rear-refinement-root button:not(.rear-refinement-dsh-trajectory *){',
    )
    expect(REFINEMENT_STYLES).toContain(
      '.rear-refinement-root h2:not(.rear-refinement-dsh-trajectory *){',
    )
    expect(REFINEMENT_STYLES).not.toContain('.rear-refinement-root button{')
    expect(REFINEMENT_STYLES).not.toContain('.rear-refinement-root *{box-sizing:border-box}')
    expect(REFINEMENT_STYLES).not.toContain('.rear-refinement-root h2{')
  })

  it('highlights only explicit trajectory selections, not Task comparison rows', () => {
    expect(REFINEMENT_STYLES).not.toContain('.rear-refinement-task-table tbody tr[data-changed="true"]')
    expect(REFINEMENT_STYLES).not.toContain('.rear-refinement-task-table tbody tr[data-selected="true"]')
    expect(REFINEMENT_STYLES).toContain('.rear-refinement-selectable-score[data-selected="true"]')
    expect(REFINEMENT_STYLES).toContain('.rear-refinement-attempt-option[data-selected="true"]')
  })

})
