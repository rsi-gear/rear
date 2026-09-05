import type { RefinementRunView } from './types.ts'

/** A native phase group contributes one observation per trial, not per conversation. */
export function uniqueTrialRuns(runs: readonly RefinementRunView[]): RefinementRunView[] {
  return [...new Map(runs.map(run => [run.phase ? `${run.evalId}\0${run.trialId}` : run.id, run])).values()]
}

export function runAggregationIdentity(run: RefinementRunView): string {
  if (run.aggregationIdentity !== undefined) return run.aggregationIdentity
  try {
    const value = JSON.parse(run.protocolIdentity) as Record<string, unknown>
    const { initial_workspace_digest: _initial, ...policy } = value
    return JSON.stringify(policy)
  } catch { return run.protocolIdentity }
}

/** Compare actual task environment while using the persisted policy for time budgets. */
export function comparisonProtocolIdentity(run: RefinementRunView): string {
  if (run.aggregationIdentity === undefined) return run.protocolIdentity
  const { timeout_ms: _remaining, ...protocol } = JSON.parse(run.protocolIdentity) as Record<string, unknown>
  return JSON.stringify({ policy: run.aggregationIdentity, protocol })
}
