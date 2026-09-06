/**
 * Client-safe refinement identities, records, evidence projections, and Remote results.
 * @module dsh-plugin-rear/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session/types'
import type { VerifierEvidence } from './hitch-evidence.ts'

/** Identifies one Gear evolution projected into the Rear view. */
export type RefinementId = Branded<'RefinementId'>
/** Identifies one Gear round projected into the Rear view. */
export type RefinementIterationId = Branded<'RefinementIterationId'>
/** Identifies one candidate inside a refinement lineage. */
export type RefinementCandidateId = Branded<'RefinementCandidateId'>
/** Identifies one Hitch evaluation without exposing its storage location. */
export type HitchEvalId = Branded<'HitchEvalId'>
/** Identifies one Hitch run without exposing its storage location. */
export type HitchRunId = Branded<'HitchRunId'>
/** Equality-only token derived from the current Gear registry entry and rounds. */
export type RefinementVersion = Branded<'RefinementVersion'>
/** Equality-only invalidation token carried by change notifications. */
export type RefinementChangeToken = Branded<'RefinementChangeToken'>

/** DSH Session lifecycle that scopes one browser controller and read request. */
export interface RefinementSessionIdentity {
  readonly sessionId: SessionId
  readonly createdAt: number
  readonly cwd?: string
}

/** Read-only projection of the Gear evolution lifecycle. */
export type RefinementStatus =
  | 'queued'
  | 'running'
  | 'awaiting-review'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Stable machine failure retained on a refinement or iteration. */
export interface RefinementFailure {
  readonly code: string
  readonly message: string
}

/** One candidate and its requested revision lineage. */
export interface RefinementCandidateRecord {
  readonly id: RefinementCandidateId
  readonly role: 'baseline' | 'candidate'
  readonly parentCandidateId: RefinementCandidateId | null
  readonly requestedHarnessRef: string
  readonly revisionIdentity: string | null
  readonly label: string
  /** Gear-owned candidate lifecycle state retained for failed/no-evaluation rows. */
  readonly status?: string
  /** Authoritative persisted proposal outcome/rationale for this candidate, when available. */
  readonly directionSummary?: string
  readonly failure?: RefinementFailure
  readonly createdAt: number
}

/** One authoritative Hitch evaluation reference associated by Gear evidence. */
export interface RefinementEvaluationRef {
  readonly providerId: string
  readonly evalId: HitchEvalId
  readonly candidateId: RefinementCandidateId
  readonly requestedModelId: string
  readonly benchmarkId: string
  readonly benchmarkRevision: string
  /** Gear's persisted evaluation condition, excluding per-run remaining budgets. */
  readonly conditionId?: string
  /** Gear's authoritative dataset role; benchmark revisions alone do not name a split. */
  readonly partition?: 'train' | 'test'
  /** Shared seed/held-out plan identity for one experiment combination, not run comparability. */
  readonly planIdentity?: string
  /** Gear currently owns an explicit task-level rerun for this eval. */
  readonly rerunning?: true
  /** Present only when Gear authoritatively recorded this as failed evaluation evidence. */
  readonly failedEvaluation?: {
    readonly phase: string
    readonly code: string
    readonly message: string
  }
}

/** One ordered candidate-generation and evaluation interval. */
export interface RefinementIterationRecord {
  readonly id: RefinementIterationId
  readonly ordinal: number
  readonly status: 'preparing' | 'evaluating' | 'rerunning' | 'settled' | 'failed' | 'cancelled'
  readonly candidateIds: readonly RefinementCandidateId[]
  readonly evaluationRefs: readonly RefinementEvaluationRef[]
  readonly createdAt: number
  readonly completedAt?: number
  /** Authoritative persisted summary of the iteration direction, when Gear provides one. */
  readonly directionSummary?: string
  readonly failure?: RefinementFailure
}

/** Complete read-only Gear evolution projection used by the existing workbench UI. */
export interface RefinementRecordV1 {
  readonly schemaVersion: 1
  readonly id: RefinementId
  readonly session: RefinementSessionIdentity
  readonly objective: string | null
  /** Compatibility source descriptor; the Gear-backed runtime always reports `gear`. */
  readonly driver: {
    readonly id: string
    readonly operationId: string | null
  }
  readonly evidenceProviderId: string
  readonly status: RefinementStatus
  readonly baselineCandidateId: RefinementCandidateId | null
  readonly activeIterationId: RefinementIterationId | null
  readonly candidates: readonly RefinementCandidateRecord[]
  readonly iterations: readonly RefinementIterationRecord[]
  readonly createdAt: number
  readonly updatedAt: number
  readonly completedAt?: number
  readonly failure?: RefinementFailure
  readonly version: RefinementVersion
}

/** Lightweight record returned by list. */
export interface RefinementSummary {
  readonly id: RefinementId
  readonly objective: string | null
  readonly status: RefinementStatus
  readonly activeIterationId: RefinementIterationId | null
  readonly iterationCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly version: RefinementVersion
  readonly failure?: RefinementFailure
}

/** One run projected from authoritative evaluation evidence. */
export interface RefinementRunView {
  readonly id: HitchRunId
  readonly evalId: HitchEvalId
  readonly candidateId: RefinementCandidateId
  readonly trialId: string
  readonly attempt: number
  readonly taskKey: string
  readonly taskId: string
  readonly execution: 'queued' | 'preparing' | 'running' | 'succeeded' | 'failed' | 'timed-out' | 'cancelled'
  readonly observation: { readonly state: 'pending' } | { readonly state: 'valid'; readonly reward: number } | { readonly state: 'invalid'; readonly reason: string }
  readonly integrity: 'valid' | 'pending' | 'corrupt'
  readonly harness: { readonly requestedRef: string; readonly id: string; readonly revisionIdentity: string | null }
  readonly model: { readonly requestedId: string; readonly provider: string | null; readonly effectiveId: string | null }
  readonly protocolIdentity: string
  /** Immutable execution provenance retained by Hitch's sealed result bundle. */
  readonly executionEvidence?: {
    readonly provider: string
    readonly workerId?: string
    readonly leaseId?: string
    readonly images: readonly {
      readonly imageId: string
      readonly imageDigest: string
      readonly reference: string
    }[]
    readonly requestedResources?: Readonly<Record<string, number>>
    readonly observedResources?: Readonly<Record<string, number>>
  }
  /** Model-interaction capture policy and completeness, when Hitch recorded it. */
  readonly capture?: {
    readonly mode: 'off' | 'native' | 'proxy' | 'hybrid'
    readonly required: boolean
    readonly completeness: 'complete' | 'partial' | 'none'
    readonly interactionCount: number
    readonly interactionAvailable: boolean
    readonly redaction: {
      readonly policy: string
      readonly status: 'applied' | 'not-needed' | 'failed'
    }
  }
  /** Stable evaluation policy used for cross-task aggregation; raw protocol is retained above. */
  readonly aggregationIdentity?: string
  /** A whole trial is scored once, even when it contains several conversations. */
  readonly phase?: { readonly groupId: string; readonly index: number; readonly count: number }
  readonly verifier?: VerifierEvidence
  readonly trajectory: {
    readonly availability: 'available' | 'provider-only' | 'pending' | 'missing' | 'corrupt' | 'unsupported'
    readonly hasCanonical: boolean
    readonly providerFileCount: number
    readonly summary?: {
      readonly turnCount?: number
      readonly toolCalls?: number
      readonly inputTokens?: number
      readonly outputTokens?: number
      readonly ttftMs?: number
    }
  }
  readonly startedAt?: number
  readonly completedAt?: number
}

/** Fine-grained read-only phase of a Hitch daemon evaluation. */
export type RefinementEvaluationPhase = 'queued' | 'planning' | 'preparing' | 'running' | 'finalizing' | 'cancelling'

/** One Hitch evaluation projection with all attempts retained. */
export interface RefinementEvaluationProjection {
  readonly ref: RefinementEvaluationRef
  readonly status: 'queued' | 'running' | 'rerunning' | 'succeeded' | 'failed' | 'cancelled' | 'corrupt'
  readonly phase?: RefinementEvaluationPhase
  readonly plannedTasks: number | null
  readonly settledTasks: number
  readonly runs: readonly RefinementRunView[]
  readonly diagnostics: readonly RefinementFailure[]
}

/** Dimension fixed by a strict comparison. */
export type RefinementComparisonDimension = 'harness' | 'model'

/** Stable reason why evidence cannot support a strict conclusion. */
export interface RefinementComparisonExclusion {
  readonly runId: HitchRunId
  readonly code: string
}

/** One task aggregate preserving every underlying attempt. */
export interface RefinementTaskComparison {
  readonly taskKey: string
  readonly taskId: string
  readonly referenceRunIds: readonly HitchRunId[]
  readonly candidateRunIds: readonly HitchRunId[]
  readonly referenceMean: number | null
  readonly candidateMean: number | null
  readonly delta: number | null
  readonly status: 'regressed' | 'invalid' | 'improved' | 'unchanged' | 'pending'
}

/** Host-owned strict or exploratory comparison result. */
export interface RefinementStrictComparisonResult {
  readonly strict: boolean
  readonly dimension: RefinementComparisonDimension
  readonly referenceRunId: HitchRunId | null
  readonly exclusions: readonly RefinementComparisonExclusion[]
  readonly tasks: readonly RefinementTaskComparison[]
}

/** Evaluation response versioned independently from the DSH record. */
export interface RefinementEvaluationView {
  readonly evidenceVersion: string
  readonly evaluations: readonly RefinementEvaluationProjection[]
  readonly comparison: RefinementStrictComparisonResult
}

/** JSON value retained across the canonical artifact Remote boundary. */
export type RefinementJsonValue = null | boolean | number | string | RefinementJsonValue[] | { [key: string]: RefinementJsonValue }

/** JSON-safe event envelope projected from one validated Session artifact. */
export interface CanonicalTrajectoryEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: RefinementJsonValue
  readonly ignorable?: true
  readonly sourceEventSeqs?: readonly number[]
  readonly surfaceOp?: 'append' | { readonly op: 'replace'; readonly start: number; readonly end: number }
}

/** Lossless compact form for consecutive canonical assistant delta events. */
export interface CanonicalTrajectoryChunkRecord {
  readonly type: 'text-chunks' | 'reasoning-chunks' | 'tool-call-chunks'
  readonly seq0: number
  readonly time0: number
  readonly data: {
    readonly turn: number
    readonly step: number
    readonly index: number
    readonly dt: readonly number[]
    readonly texts?: readonly string[]
    readonly id?: string
    readonly name?: string
    readonly args?: readonly string[]
  }
}

/** One canonical event or a losslessly packed run of streaming delta events. */
export type CanonicalTrajectoryRecord = CanonicalTrajectoryEvent | CanonicalTrajectoryChunkRecord

/** Canonical completed Session document used by an offline Trajectory surface. */
export interface CanonicalTrajectoryDocument {
  readonly runId: HitchRunId
  readonly header: SessionHeader
  readonly records: readonly CanonicalTrajectoryRecord[]
}

/** One provider-native evidence descriptor. */
export interface RefinementProviderEvidenceDescriptor {
  readonly ordinal: number
  readonly role: string
  readonly mediaType: string
  readonly bytes: number
  readonly sha256: string
}

/** One bounded provider-native evidence page. */
export interface RefinementProviderEvidencePage {
  readonly runId: HitchRunId
  readonly file: RefinementProviderEvidenceDescriptor
  readonly encoding: 'utf8' | 'base64'
  readonly content: string
  readonly nextCursor: string | null
}

/** One bounded page from Hitch's independently captured model interactions. */
export interface RefinementInteractionEvidencePage extends RefinementProviderEvidencePage {}

/** List request for one exact persisted Session lifecycle. */
export interface RefinementListRequest {
  readonly sessionId: SessionId
}

/** List response value. */
export interface RefinementListValue {
  readonly records: readonly RefinementSummary[]
}

/** Detail request. */
export interface RefinementGetRequest {
  readonly sessionId: SessionId
  readonly refinementId: RefinementId
}

/** Evidence request for one selected iteration. */
export interface RefinementEvaluationRequest extends RefinementGetRequest {
  readonly iterationId: RefinementIterationId
  readonly dimension: RefinementComparisonDimension
  readonly referenceRunId: HitchRunId | null
}

/** Canonical trajectory request for one referenced run. */
export interface RefinementTrajectoryRequest extends RefinementGetRequest {
  readonly runId: HitchRunId
}

/** Lossless UTF-8 fragments allow even a single large event to cross bounded RPCs. */
export interface RefinementTrajectoryPageRequest extends RefinementTrajectoryRequest {
  readonly cursor: string | null
}
export interface RefinementTrajectoryPage {
  readonly runId: HitchRunId
  readonly sha256: string
  readonly totalBytes: number
  readonly content: string
  readonly nextCursor: string | null
}
export type RefinementTrajectoryPageResult = RefinementSuccess<RefinementTrajectoryPage> | RefinementRejected

/** Bounded provider evidence request for one referenced run. */
export interface RefinementProviderEvidenceRequest extends RefinementTrajectoryRequest {
  readonly fileOrdinal: number
  readonly cursor: string | null
}

/** Bounded model-interaction evidence request for one referenced run. */
export interface RefinementInteractionEvidenceRequest extends RefinementTrajectoryRequest {
  readonly cursor: string | null
}

/** Stable business failure shared by refinement operations. */
export interface RefinementBusinessFailure {
  readonly code:
    | 'refinement-not-found'
    | 'evidence-provider-unavailable'
    | 'evaluation-not-found'
    | 'run-not-found'
    | 'trajectory-not-found'
    | 'trajectory-corrupt'
    | 'response-too-large'
  readonly message: string
}

/** Successful refinement operation. */
export interface RefinementSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Business-rejected refinement operation. */
export interface RefinementRejected {
  readonly ok: false
  readonly error: RefinementBusinessFailure
}

/** List result. */
export type RefinementListResult = RefinementSuccess<RefinementListValue> | RefinementRejected
/** Detail result. */
export type RefinementGetResult = RefinementSuccess<RefinementRecordV1> | RefinementRejected
/** Evaluation result. */
export type RefinementEvaluationResult = RefinementSuccess<RefinementEvaluationView> | RefinementRejected
/** Canonical trajectory result. */
export type RefinementTrajectoryResult = RefinementSuccess<CanonicalTrajectoryDocument> | RefinementRejected
/** Provider evidence result. */
export type RefinementProviderEvidenceResult = RefinementSuccess<RefinementProviderEvidencePage> | RefinementRejected
/** Model-interaction evidence result. */
export type RefinementInteractionEvidenceResult = RefinementSuccess<RefinementInteractionEvidencePage> | RefinementRejected

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A refinement record or referenced evidence changed; clients must perform an authoritative read.
     * @param sessionId - owning Session id.
     * @param refinementId - invalidated refinement.
     * @param changeToken - equality-only invalidation token.
     * @mode emit
     */
    'refinement/change'(
      sessionId: SessionId,
      refinementId: RefinementId,
      changeToken: RefinementChangeToken,
    ): void
  }
}
