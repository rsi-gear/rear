import { describe, expect, it } from 'vitest'
import type { CanonicalTrajectoryDocument } from '../../src/types.ts'
import {
  canonicalTrajectoryInputs,
  resolveDshTrajectoryComponent,
} from '../../src/client/DshOfflineTrajectorySurface.tsx'

function document(): CanonicalTrajectoryDocument {
  return {
    runId: 'run_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as CanonicalTrajectoryDocument['runId'],
    header: {
      type: 'session', version: 0, id: 'session-test', createdAt: 1_000,
    } as unknown as CanonicalTrajectoryDocument['header'],
    events: [
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
    expect(inputs[0]?.event).toBe(source.events[0])
    expect(inputs[1]?.event).toBe(source.events[1])
    expect(inputs.map(input => input.view)).toEqual([undefined, undefined])
  })

})
