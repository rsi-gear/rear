/** Host-only Hitch evidence reader contracts. */

import type {
  CanonicalTrajectoryDocument,
  HitchRunId,
  RefinementComparisonDimension,
  RefinementEvaluationProjection,
  RefinementEvaluationRef,
  RefinementInteractionEvidencePage,
  RefinementProviderEvidencePage,
  RefinementStrictComparisonResult,
} from './types.ts'

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

/** Provider-owned independently captured model-interaction lookup. */
export interface RefinementInteractionEvidenceLookup extends RefinementTrajectoryLookup {
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
  interactionEvidence(request: RefinementInteractionEvidenceLookup): Promise<RefinementInteractionEvidencePage>
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
