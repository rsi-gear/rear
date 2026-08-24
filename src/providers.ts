/** Host-only refinement driver and evidence provider contracts. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  CanonicalTrajectoryDocument,
  HitchRunId,
  RefinementCandidateId,
  RefinementCandidateRecord,
  RefinementComparisonDimension,
  RefinementEvaluationProjection,
  RefinementEvaluationRef,
  RefinementFailure,
  RefinementIterationId,
  RefinementIterationRecord,
  RefinementProviderEvidencePage,
  RefinementRecordV1,
  RefinementStrictComparisonResult,
  RefinementVersion,
} from './types.ts'

/** Candidate fields assigned by a driver; the runtime owns id and time. */
export interface RefinementCandidateInput {
  readonly role: RefinementCandidateRecord['role']
  readonly parentCandidateId: RefinementCandidateId | null
  readonly requestedHarnessRef: string
  readonly revisionIdentity: string | null
  readonly label: string
}

/** Iteration fields assigned by a driver; the runtime owns id, ordinal, and time. */
export interface RefinementIterationInput {
  readonly candidateIds: readonly RefinementCandidateId[]
}

/** Operation-scoped mutation capabilities. Every mutation requires and replaces the record version. */
export interface RefinementDriverCapabilities {
  setOperationId(expected: RefinementVersion, operationId: string): Promise<RefinementRecordV1>
  addCandidate(expected: RefinementVersion, candidate: RefinementCandidateInput): Promise<RefinementRecordV1>
  beginIteration(expected: RefinementVersion, iteration: RefinementIterationInput): Promise<RefinementRecordV1>
  attachEvaluation(
    expected: RefinementVersion,
    iterationId: RefinementIterationId,
    ref: RefinementEvaluationRef,
  ): Promise<RefinementRecordV1>
  settleIteration(
    expected: RefinementVersion,
    iterationId: RefinementIterationId,
    status: Extract<RefinementIterationRecord['status'], 'settled' | 'failed' | 'cancelled'>,
    failure?: RefinementFailure,
  ): Promise<RefinementRecordV1>
  finish(
    expected: RefinementVersion,
    status: Extract<RefinementRecordV1['status'], 'awaiting-review' | 'completed' | 'failed' | 'cancelled'>,
    failure?: RefinementFailure,
  ): Promise<RefinementRecordV1>
}

/** Exact driver operation admitted for one refinement. */
export interface RefinementDriverOperation {
  readonly agent: Agent | null
  readonly record: RefinementRecordV1
  readonly signal: AbortSignal
  readonly capabilities: RefinementDriverCapabilities
}

/** Driver cancellation outcome; external work may outlive the Host request. */
export type RefinementDriverCancelResult = 'stopped' | 'still-running' | 'already-terminal'

/** Swappable harness candidate generator and evaluation orchestrator. */
export interface RefinementDriver {
  readonly id: string
  available(): boolean
  run(operation: RefinementDriverOperation): Promise<void>
  resume(operation: RefinementDriverOperation): Promise<void>
  cancel(record: RefinementRecordV1): Promise<RefinementDriverCancelResult>
}

/** Provider-owned strict comparison request. */
export interface RefinementComparisonRequest {
  readonly refs: readonly RefinementEvaluationRef[]
  readonly dimension: RefinementComparisonDimension
  readonly referenceRunId: HitchRunId | null
}

/** Provider-owned canonical trajectory lookup. */
export interface RefinementTrajectoryLookup {
  readonly evalRef: RefinementEvaluationRef
  readonly runId: HitchRunId
}

/** Provider-owned native evidence lookup. */
export interface RefinementProviderEvidenceLookup extends RefinementTrajectoryLookup {
  readonly fileOrdinal: number
  readonly cursor: string | null
  readonly maxBytes: number
}

/** Swappable read-only evaluator evidence adapter. */
export interface RefinementEvidenceProvider {
  readonly id: string
  available(): boolean
  evaluation(ref: RefinementEvaluationRef): Promise<RefinementEvaluationProjection>
  compare(request: RefinementComparisonRequest): Promise<RefinementStrictComparisonResult>
  trajectory(request: RefinementTrajectoryLookup): Promise<CanonicalTrajectoryDocument>
  providerEvidence(request: RefinementProviderEvidenceLookup): Promise<RefinementProviderEvidencePage>
  watch(ref: RefinementEvaluationRef, onChange: () => void): () => void
}

/** Provider-origin business error retained across the runtime adapter. */
export class RefinementProviderError extends Error {
  /** @param code - stable public business code. @param message - safe user-facing explanation. */
  constructor(
    readonly code: 'evaluation-not-found' | 'run-not-found' | 'trajectory-not-found' | 'trajectory-corrupt',
    message: string,
  ) {
    super(message)
    this.name = 'RefinementProviderError'
  }
}
